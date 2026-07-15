class PcmProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.targetSampleRate = Number(options?.processorOptions?.targetSampleRate) || 24000;
        this.resampleRatio = sampleRate / this.targetSampleRate;
        this.sourcePosition = 0;
        this.pendingSamples = [];
        this.chunkSize = this.targetSampleRate / 10;
    }

    process(inputs) {
        const input = inputs[0]?.[0];

        if (!input?.length) {
            return true;
        }

        this.downsample(input);

        while (this.pendingSamples.length >= this.chunkSize) {
            const samples = this.pendingSamples.splice(0, this.chunkSize);
            this.postPcmChunk(samples);
        }

        return true;
    }

    downsample(input) {
        while (this.sourcePosition < input.length - 1) {
            const beforeIndex = Math.floor(this.sourcePosition);
            const afterIndex = beforeIndex + 1;
            const weight = this.sourcePosition - beforeIndex;
            const sample = input[beforeIndex] + (input[afterIndex] - input[beforeIndex]) * weight;

            this.pendingSamples.push(sample);
            this.sourcePosition += this.resampleRatio;
        }

        this.sourcePosition -= input.length;
    }

    postPcmChunk(samples) {
        const pcmBuffer = new ArrayBuffer(samples.length * 2);
        const view = new DataView(pcmBuffer);

        for (let index = 0; index < samples.length; index++) {
            const sample = Math.max(-1, Math.min(1, samples[index]));
            const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            view.setInt16(index * 2, int16Sample, true);
        }

        this.port.postMessage(pcmBuffer, [pcmBuffer]);
    }
}

registerProcessor('pcm-processor', PcmProcessor);
