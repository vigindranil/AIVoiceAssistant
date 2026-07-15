const { WebSocket } = require('ws');

function createOpenAIRealtimeTranscriber({ apiKey, model = 'gpt-realtime-whisper', sessionModel = 'gpt-realtime-mini', onReady, onTranscript, onError }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required when STT_PROVIDER=openai.');
  const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(sessionModel)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  let configured = false;
  let audioSinceCommit = false;
  let stopRequested = false;
  let awaitingTranscript = false;
  let deltaTranscript = '';
  const pendingAudio = [];

  const send = payload => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  const append = buffer => {
    const audio = Buffer.from(buffer).toString('base64');
    if (!configured) {
      if (pendingAudio.length < 200) pendingAudio.push(audio);
      return;
    }
    send({ type: 'input_audio_buffer.append', audio });
    audioSinceCommit = true;
  };

  socket.on('message', message => {
    let event;
    try { event = JSON.parse(message.toString()); } catch { return; }
    if (event.type === 'session.created') {
      send({
        type: 'session.update',
        session: {
          type: 'realtime',
          output_modalities: ['text'],
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              noise_reduction: { type: 'far_field' },
              transcription: { model, language: 'en' },
              turn_detection: {
                type: 'server_vad', threshold: 0.45, prefix_padding_ms: 300,
                silence_duration_ms: 650, create_response: false, interrupt_response: false,
              },
            },
          },
        },
      });
      return;
    }
    if (event.type === 'session.updated') {
      configured = true;
      const queuedAudio = pendingAudio.splice(0);
      for (const audio of queuedAudio) send({ type: 'input_audio_buffer.append', audio });
      if (queuedAudio.length) audioSinceCommit = true;
      onReady?.();
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      deltaTranscript += event.delta || '';
      onTranscript?.({ transcript: deltaTranscript.trim(), alternatives: [], isFinal: false, confidence: null });
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = String(event.transcript || deltaTranscript).trim();
      deltaTranscript = '';
      awaitingTranscript = false;
      if (transcript) onTranscript?.({ transcript, alternatives: [transcript], isFinal: true, confidence: null });
      if (stopRequested) socket.close();
      return;
    }
    if (event.type === 'input_audio_buffer.committed') {
      audioSinceCommit = false;
      awaitingTranscript = true;
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.failed' || event.type === 'error') {
      onError?.(new Error(event.error?.message || 'OpenAI realtime transcription failed.'));
    }
  });
  socket.on('error', onError);

  return {
    get writable() { return socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING; },
    write: append,
    end() {
      stopRequested = true;
      if (configured && audioSinceCommit) { awaitingTranscript = true; send({ type: 'input_audio_buffer.commit' }); }
      else if (configured && !awaitingTranscript && !deltaTranscript) socket.close();
    },
    close() { if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(); },
  };
}

module.exports = { createOpenAIRealtimeTranscriber };
