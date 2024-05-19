const dropZone = document.getElementById('drop_zone');
const fileInput = document.getElementById('fileInput');
const downloadLink = document.getElementById('downloadLink');
const outputAudio = document.getElementById('outputAudio');

// Event listeners
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleFileDrop);
fileInput.addEventListener('change', handleFileSelect);

function handleDragOver(event) {
    event.preventDefault();
    dropZone.classList.add('dragover');
}

function handleDragLeave(event) {
    event.preventDefault();
    dropZone.classList.remove('dragover');
}

function handleFileDrop(event) {
    event.preventDefault();
    dropZone.classList.remove('dragover');
    const files = event.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        processAudio();
    }
}

function handleFileSelect(event) {
    processAudio();
}

function getSelectedRadioValue(name) {
    const selectedRadio = document.querySelector(`input[name="${name}"]:checked`);
    return selectedRadio ? selectedRadio.value : null;
}

function extractBpmAndKey(fileName) {
    // Extract BPM as the last number in the file name between 55 and 190
    const bpmMatch = fileName.match(/(\d+)(?!.*\d)/);
    const bpm = bpmMatch ? parseInt(bpmMatch[0]) : 'Unknown';

    // Check if BPM is within the valid range (55 to 190)
    const validBpm = bpm >= 55 && bpm <= 190 ? bpm : 'Unknown';

    // Extract key (optional): you can adjust this regex based on your naming conventions
    const keyMatch = fileName.match(/\b([A-G][#b]?m?)\b/i);
    const key = keyMatch ? keyMatch[1] : 'Unknown';

    return { bpm: validBpm, key };
}

async function processAudio() {
    const file = fileInput.files[0];
    if (!file) {
        alert('Please select an audio file.');
        return;
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const reader = new FileReader();

    reader.onload = async function (event) {
        const audioBuffer = event.target.result;
        const buffer = await audioContext.decodeAudioData(audioBuffer);

        // Check if the audio duration is less than 30 seconds
        if (buffer.duration >= 30) {
            alert('Please upload an audio file less than 30 seconds long.');
            return;
        }

        // Get and display the file name
        const fileName = file.name;
        console.log(`Processing file: ${fileName}`);
        //document.getElementById('fileNameDisplay').textContent = `Processing file: ${fileName}`;

        const { bpm, key } = extractBpmAndKey(fileName);
        console.log(`Extracted BPM: ${bpm}, Key: ${key}`);

        const fidelity = getSelectedRadioValue('fidelity');
        const speed = getSelectedRadioValue('speed');

        if (!fidelity || !speed) {
            alert('Please select fidelity and speed options.');
            return;
        }

        const newSampleRate = getSampleRate(fidelity);
        const bitDepth = getBitDepth(fidelity);
        const speedFactor = getSpeedFactor(speed);

        const resampledBuffer = resampleBuffer(buffer, buffer.sampleRate, newSampleRate);
        const modifiedBuffer = quantizeBuffer(resampledBuffer, bitDepth, audioContext);

        await encodeResampledAudio(modifiedBuffer, bpm, key);
        
        // Reset the file input and other states
        fileInput.value = '';
    };

    reader.readAsArrayBuffer(file);
}

function getSampleRate(fidelity) {
    switch (fidelity) {
        case 'SP-1200':
            return 26000;
        case 'SK-1':
            return 9000;
        default:
            return 46000;
    }
}

function getBitDepth(fidelity) {
    switch (fidelity) {
        case 'SP-1200':
            return 12;
        case 'SK-1':
            return 8;
        default:
            return 16;
    }
}

function getSpeedFactor(speed) {
    switch (speed) {
        case '2x':
            return 2;
        case '4x':
            return 4;
        default:
            return 1;
    }
}

function resampleBuffer(buffer, sampleRate, newSampleRate) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const newLength = Math.floor(buffer.length * newSampleRate / sampleRate);
    const newBuffer = audioContext.createBuffer(buffer.numberOfChannels, newLength, newSampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const inputData = buffer.getChannelData(channel);
        const outputData = newBuffer.getChannelData(channel);

        for (let i = 0; i < newLength; i++) {
            const ratio = i * sampleRate / newSampleRate;
            const index = Math.floor(ratio);
            const frac = ratio - index;

            outputData[i] = inputData[index] * (1 - frac) + inputData[index + 1] * frac;
        }
    }

    return newBuffer;
}

function quantizeBuffer(buffer, bitDepth, audioContext) {
    const maxValue = Math.pow(2, bitDepth) - 1;
    const newBuffer = audioContext.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const inputData = buffer.getChannelData(channel);
        const outputData = newBuffer.getChannelData(channel);

        for (let i = 0; i < buffer.length; i++) {
            const quantizedValue = Math.round(inputData[i] * maxValue) / maxValue;
            outputData[i] = quantizedValue;
        }
    }

    return newBuffer;
}

async function encodeResampledAudio(buffer, bpm, key) {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const samples = buffer.length;

    const pcmLeftChannel = buffer.getChannelData(0);
    const pcmRightChannel = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : pcmLeftChannel;

    const encoder = await WasmMediaEncoder.createMp3Encoder();

    encoder.configure({
        sampleRate: sampleRate,
        channels: numberOfChannels,
        vbrQuality: 2,
    });

    let outBuffer = new Uint8Array(0);
    let offset = 0;
    const chunkSize = 1152; // Typical MP3 frame size

    for (let i = 0; i < samples; i += chunkSize) {
        const chunkLeft = pcmLeftChannel.subarray(i, i + chunkSize);
        const chunkRight = pcmRightChannel.subarray(i, i + chunkSize);

        const mp3Data = encoder.encode([chunkLeft, chunkRight]);

        if (mp3Data.length + offset > outBuffer.length) {
            const newBuffer = new Uint8Array(mp3Data.length + offset);
            newBuffer.set(outBuffer);
            outBuffer = newBuffer;
        }

        outBuffer.set(mp3Data, offset);
        offset += mp3Data.length;
    }

    // Finalize the encoding and get the remaining data
    const finalMp3Data = encoder.finalize();

    if (finalMp3Data.length + offset > outBuffer.length) {
        const newBuffer = new Uint8Array(finalMp3Data.length + offset);
        newBuffer.set(outBuffer);
        outBuffer = newBuffer;
    }

    outBuffer.set(finalMp3Data, offset);
    offset += finalMp3Data.length;

    // Create a Blob from the final output buffer
    const blob = new Blob([outBuffer], { type: 'audio/mp3' });
    const url = URL.createObjectURL(blob);

        const newFileName = `${bpm} ${key}.mp3`;

        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = newFileName;
        downloadLink.click();
}
