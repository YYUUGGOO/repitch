const dropZone = document.getElementById('drop_zone');
const fileInput = document.getElementById('fileInput');
const downloadLink = document.getElementById('downloadLink');
const outputAudio = document.getElementById('outputAudio');
const ko2Form = document.getElementById('ko2Form');
const ko2FormToggle = document.getElementById('ko2FormToggle');
const ko2FormFieldset = document.getElementById('ko2FormFieldset');
const rangeInputs = document.querySelectorAll('input[type="range"]');
const rootnoteInput = document.getElementById('sound.rootnote');
const rootnootOutput = document.querySelector(`output[for="sound.rootnote"]`);
let fileName;

const NOTE_MAP = {};
const NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

for (let i = 0; i < 12; i++) {
    NOTE_MAP[i] = `N${i + 1}`;
}
for (let i = 12; i < 128; i++) {
    const note = NOTES[(i - 12) % NOTES.length];
    const octave = Math.floor((i - 12) / NOTES.length);
    NOTE_MAP[i] = `${note}${octave}`;
}

// Event listeners
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleFileDrop);
fileInput.addEventListener('change', handleFileSelect);
ko2FormToggle.addEventListener('change', handleKO2FormState);
rangeInputs.forEach(input => input.addEventListener('input', handleRangeOutput));
rangeInputs.forEach(input => handleRangeOutput({ currentTarget: input }))
rootnoteInput.addEventListener('input', handleRootnoteOutput);
handleRootnoteOutput();

function handleRangeOutput({ currentTarget }) {
    const id = currentTarget.id;
    const outputElement = document.querySelector(`output[for="${id}"]`);
    if (outputElement) {
        outputElement.value = currentTarget.value;
    }
}

function handleRootnoteOutput() {
    rootnootOutput.value = NOTE_MAP[rootnoteInput.value];
}

function handleKO2FormState() {
    ko2FormFieldset.toggleAttribute('disabled');
}

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
        processFiles(files);
    }
}

function handleFileSelect(event) {
    const files = event.target.files;
    if (files.length > 0) {
        processFiles(files);
    }
}


function getSelectedRadioValue(name) {
    const selectedRadio = document.querySelector(`input[name="${name}"]:checked`);
    return selectedRadio ? selectedRadio.value : null;
}

function getSampleRate(fidelity) {
    switch (fidelity) {
        case 'SP-1200':
            return 26000;
        case 'SP-1201':
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
            return 8;
        case 'SP-1201':
            return 16;
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

function getKO2Buffer() {
    const data = new FormData(ko2Form);
    const settings = {};
    for (const [key, value] of data) {
        // number values must be integers
        settings[key] = /^\d+$/.test(value) ? parseInt(value, 10) : value;
    }
    // If the form is disabled we want to return an empty buffer
    // to skip adding the headers. If the form is enabled a null
    // terminator is required when writing the subchunk
    const settingsStringified = JSON.stringify(settings);
    const ko2Settings = settingsStringified !== "{}" ? `${settingsStringified}\0` : ``;
    const textEncoder = new TextEncoder();

    return textEncoder.encode(ko2Settings);
}

function extractBpmAndKey(fileName) {
    // Extract BPM as the last number in the file name between 55 and 190
    const bpmMatch = fileName.match(/(\d+)(?!.*\d)/);
    const bpm = bpmMatch ? parseInt(bpmMatch[0]) : 'Unknown';

    // Check if BPM is within the valid range (55 to 190)
    const validBpm = bpm >= 55 && bpm <= 190 ? bpm : 'Unknown';

    const keyMatch = fileName.match(/\b([A-G][#b]?m?)\b/i);
    const key = keyMatch ? keyMatch[1] : 'Unknown';

    return {
        bpm: validBpm,
        key
    };
}

async function processFiles(files) {
    if (files.length === 1) {
        const processedFile = await processAudio(files[0]);
        downloadFile(processedFile.blob, processedFile.name);
    } else {
        const zip = new JSZip();
        for (let i = 0; i < files.length; i++) {
            const processedFile = await processAudio(files[i]);
            zip.file(processedFile.name, processedFile.blob);
        }
        zip.generateAsync({ type: "blob" }).then(function (content) {
            saveAs(content, "processed_files.zip");
        });
    }
}

function downloadFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
}

async function processAudio(file) {
    let getSpeedButton = getSelectedRadioValue("speed");
    let getFidelityButton = getSelectedRadioValue("fidelity");
    let channelNr = getSelectedRadioValue("channels");
    let speedVal = getSpeedFactor(getSpeedButton);
    let sRateVal = getSampleRate(getFidelityButton);
    let bitVal = getBitDepth(getFidelityButton);
    let ko2Buffer = getKO2Buffer();
    console.log("Speed: " + speedVal + " Rate: " + sRateVal + " BD: " + bitVal + " Channel: " + channelNr);

    if (!file) {
        alert('Please select files.');
        return;
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
        reader.onload = async function (event) {
            try {
                const audioBuffer = event.target.result;
                const buffer = await audioContext.decodeAudioData(audioBuffer);

                if (buffer.duration >= 30) {
                    alert('Please upload an audio file less than 30 seconds long.');
                    reject('File too long');
                    return;
                }

                fileName = file.name;
                console.log(`Processing file: ${fileName}`);
                const { bpm, key } = extractBpmAndKey(fileName);
                console.log(`Extracted BPM: ${bpm}, Key: ${key}`);

                const channelData = [];
                let x = speedVal;
                const length = Math.floor(buffer.length / x);
                let newBuffer;

                if (channelNr === '1') { // Mono
                    const monoData = new Float32Array(length);
                    for (let j = 0; j < length; j++) {
                        monoData[j] = (buffer.getChannelData(0)[j * x] + buffer.getChannelData(1)[j * x]) / 2;
                    }
                    newBuffer = audioContext.createBuffer(1, length, buffer.sampleRate);
                    newBuffer.copyToChannel(monoData, 0);
                } else { // Stereo
                    for (let i = 0; i < buffer.numberOfChannels; i++) {
                        const inputData = buffer.getChannelData(i);
                        const newData = new Float32Array(length);
                        for (let j = 0; j < length; j++) {
                            newData[j] = inputData[j * x];
                        }
                        channelData.push(newData);
                    }
                    newBuffer = audioContext.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
                    for (let i = 0; i < buffer.numberOfChannels; i++) {
                        newBuffer.copyToChannel(channelData[i], i);
                    }
                }

                const resampledBuffer = resampleBuffer(newBuffer, buffer.sampleRate, sRateVal);
                const modifiedBuffer = quantizeBuffer(resampledBuffer, bitVal, audioContext);
                const audioBlob = await encodeResampledAudio(modifiedBuffer, bpm, key, bitVal, fileName, ko2Buffer);

                resolve({ blob: audioBlob, name: fileName });
            } catch (error) {
                reject(error);
            }
        };

        reader.readAsArrayBuffer(file);
    });
}

function resampleBuffer(buffer, sampleRate, newSampleRate) {
    const audioContext = new(window.AudioContext || window.webkitAudioContext)();
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

async function encodeResampledAudio(buffer, bpm, key, bitDepth, fileName, ko2Buffer) {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const samples = buffer.length;
    let newFileName = fileName;
    let checkIfRename = getSelectedRadioValue("filename");
    if (checkIfRename === "true") {
        newFileName = `${bpm} ${key}.wav`;
    }

    const wavBuffer = audioBufferToWav(buffer, bitDepth, ko2Buffer);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    return blob;
}

function audioBufferToWav(buffer, bitDepth, ko2Buffer) {
    const ko2BufferSize = ko2Buffer.length;
    const smplSize = ko2BufferSize !== 0 ? 36 : 0; // 36 is the size when using KO-2 tool
    const listSize = ko2BufferSize !== 0 ? 12 : 0; // size of LIST, INFO, and TNGE headers

    const numOfChannels = buffer.numberOfChannels;
    const dataSize = buffer.length * numOfChannels * (bitDepth / 8)
    const length = smplSize + listSize + ko2BufferSize  + dataSize + 44;

    const result = new ArrayBuffer(length);
    const view = new DataView(result);
    const channels = [];
    let offset = 0;
    let pos = 0;

    // Write WAV header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChannels);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * (bitDepth / 8) * numOfChannels); // avg. bytes/sec
    setUint16(numOfChannels * (bitDepth / 8)); // block-align
    setUint16(bitDepth); // bit depth

    if (ko2BufferSize > 0) {
        // smpl subchunk
        setUint32(0x6C706D73); // "smpl"
        setUint32(smplSize);
        // Fill with padding
        for (let i = 0; i < smplSize; i++) {
            view.setUint8(pos, 0x00);
            pos++;
        }

        // LIST subchunk
        setUint32(0x5453494C); // "LIST"
        setUint32(listSize + ko2BufferSize);
        // INFO subchunk
        setUint32(0x4F464E49); // INFO
        setUint32(0x45474E54); // TNGE
        setUint32(ko2BufferSize);
        // Add EP-133 sample metadata
        for (let i = 0; i < ko2BufferSize; i++) {
            view.setUint8(pos, ko2Buffer[i]);
            pos++;
        }
    }

    setUint32(0x61746164); // "data" - chunk
    setUint32(dataSize); // chunk length

    // Write interleaved data
    for (let i = 0; i < buffer.numberOfChannels; i++)
        channels.push(buffer.getChannelData(i));

    while (pos < length) {
        for (let i = 0; i < numOfChannels; i++) { // interleave channels
            let sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
            if (bitDepth === 8) {
                // Convert to 8-bit unsigned
                sample = ((sample + 1) * 127.5) | 0;
                view.setUint8(pos, sample);
            } else {
                // Convert to signed int
                sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                if (bitDepth === 16) {
                    view.setInt16(pos, sample, true);
                } else if (bitDepth === 24) {
                    view.setInt32(pos, sample << 8, true);
                } else if (bitDepth === 32) {
                    view.setInt32(pos, sample, true);
                }
            }
            pos += bitDepth / 8;
        }
        offset++; // next source sample
    }

    return result;

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}
//service worker implementation for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
          console.log('ServiceWorker registration successful with scope: ', registration.scope);
        })
        .catch(error => {
          console.log('ServiceWorker registration failed: ', error);
        });
    });
  }
