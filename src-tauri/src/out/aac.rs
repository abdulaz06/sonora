//! AAC-LC encoding with the encoder that ships with Windows (Media Foundation's
//! AAC MFT): no bundled codec. Input is 16-bit interleaved PCM at 44.1 or
//! 48 kHz, mono or stereo; output is raw AAC frames (1024 samples each) plus
//! the AudioSpecificConfig for the MP4 muxer (the web side muxes).

#[cfg(windows)]
mod imp {
    use windows::core::Interface;
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

    /// One running encoder. Media Foundation objects are free-threaded; every
    /// call initialises COM (MTA) on its thread first.
    pub struct AacEncoder {
        mft: IMFTransform,
        pub sample_rate: u32,
        pub channels: u32,
        pub asc: Vec<u8>,
        out_size: u32,
        /// Samples (per channel) fed so far: input timestamps.
        fed: u64,
    }
    // SAFETY: the AAC MFT is free-threaded (MTA); the encoder is only used behind a Mutex.
    unsafe impl Send for AacEncoder {}

    fn com() {
        // Already initialised on this thread (any mode) is fine.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let _ = MFStartup(MF_VERSION, MFSTARTUP_LITE);
        }
    }

    impl AacEncoder {
        /// `bytes_per_sec`: 12000, 16000, 20000 or 24000 (96–192 kbps), the encoder's choices.
        pub fn new(sample_rate: u32, channels: u32, bytes_per_sec: u32) -> Result<Self, String> {
            com();
            unsafe { Self::create(sample_rate, channels, bytes_per_sec) }.map_err(|e| format!("AAC encoder: {e}"))
        }

        unsafe fn create(sample_rate: u32, channels: u32, bytes_per_sec: u32) -> windows::core::Result<Self> {
            let mft: IMFTransform = CoCreateInstance(&AACMFTEncoder, None, CLSCTX_INPROC_SERVER)?;
            let input = MFCreateMediaType()?;
            input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
            input.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM)?;
            input.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
            input.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, sample_rate)?;
            input.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, channels)?;
            input.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, channels * 2)?;
            input.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, sample_rate * channels * 2)?;
            mft.SetInputType(0, &input, 0)?;
            let output = MFCreateMediaType()?;
            output.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
            output.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC)?;
            output.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
            output.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, sample_rate)?;
            output.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, channels)?;
            output.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, bytes_per_sec)?;
            output.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0)?;
            output.SetUINT32(&MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, 0x29)?;
            mft.SetOutputType(0, &output, 0)?;
            // MF_MT_USER_DATA = HEAACWAVEINFO's tail (12 bytes) + AudioSpecificConfig.
            let cur = mft.GetOutputCurrentType(0)?;
            let n = cur.GetBlobSize(&MF_MT_USER_DATA)? as usize;
            let mut blob = vec![0u8; n];
            cur.GetBlob(&MF_MT_USER_DATA, &mut blob, None)?;
            let asc = if n > 12 { blob[12..].to_vec() } else { asc_for(sample_rate, channels) };
            let info = mft.GetOutputStreamInfo(0)?;
            mft.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            mft.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
            Ok(Self { mft, sample_rate, channels, asc, out_size: info.cbSize.max(8192), fed: 0 })
        }

        /// Feed interleaved 16-bit PCM; returns the AAC frames that came out.
        pub fn encode(&mut self, pcm: &[i16]) -> Result<Vec<Vec<u8>>, String> {
            com();
            let mut out = Vec::new();
            if pcm.is_empty() {
                return Ok(out);
            }
            unsafe { self.feed(pcm, &mut out) }.map_err(|e| format!("AAC encode: {e}"))?;
            Ok(out)
        }

        unsafe fn feed(&mut self, pcm: &[i16], out: &mut Vec<Vec<u8>>) -> windows::core::Result<()> {
            let bytes = pcm.len() * 2;
            let buf = MFCreateMemoryBuffer(bytes as u32)?;
            let mut p: *mut u8 = std::ptr::null_mut();
            buf.Lock(&mut p, None, None)?;
            std::ptr::copy_nonoverlapping(pcm.as_ptr() as *const u8, p, bytes);
            buf.Unlock()?;
            buf.SetCurrentLength(bytes as u32)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buf)?;
            let frames = (pcm.len() / self.channels as usize) as u64;
            sample.SetSampleTime((self.fed * 10_000_000 / self.sample_rate as u64) as i64)?;
            sample.SetSampleDuration((frames * 10_000_000 / self.sample_rate as u64) as i64)?;
            self.fed += frames;
            // The encoder may refuse input until its output is drained.
            loop {
                match self.mft.ProcessInput(0, &sample, 0) {
                    Ok(()) => break,
                    Err(e) if e.code() == MF_E_NOTACCEPTING => self.drain_output(out)?,
                    Err(e) => return Err(e),
                }
            }
            self.drain_output(out)
        }

        unsafe fn drain_output(&mut self, out: &mut Vec<Vec<u8>>) -> windows::core::Result<()> {
            loop {
                let buf = MFCreateMemoryBuffer(self.out_size)?;
                let sample = MFCreateSample()?;
                sample.AddBuffer(&buf)?;
                let mut db = [MFT_OUTPUT_DATA_BUFFER { dwStreamID: 0, pSample: core::mem::ManuallyDrop::new(Some(sample.clone())), dwStatus: 0, pEvents: core::mem::ManuallyDrop::new(None) }];
                let mut status = 0u32;
                let r = self.mft.ProcessOutput(0, &mut db, &mut status);
                // Release what ProcessOutput may have handed back.
                core::mem::ManuallyDrop::drop(&mut db[0].pSample);
                core::mem::ManuallyDrop::drop(&mut db[0].pEvents);
                match r {
                    Ok(()) => {
                        let b = sample.ConvertToContiguousBuffer()?;
                        let mut p: *mut u8 = std::ptr::null_mut();
                        let mut len = 0u32;
                        b.Lock(&mut p, None, Some(&mut len))?;
                        if len > 0 {
                            out.push(std::slice::from_raw_parts(p, len as usize).to_vec());
                        }
                        b.Unlock()?;
                    }
                    Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(()),
                    Err(e) => return Err(e),
                }
            }
        }

        /// End of stream: whatever the encoder still holds.
        pub fn finish(&mut self) -> Result<Vec<Vec<u8>>, String> {
            com();
            let mut out = Vec::new();
            unsafe {
                self.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0).map_err(|e| e.to_string())?;
                self.mft.ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0).map_err(|e| e.to_string())?;
                self.drain_output(&mut out).map_err(|e| e.to_string())?;
            }
            Ok(out)
        }
    }

    impl Drop for AacEncoder {
        fn drop(&mut self) {
            unsafe {
                let _ = self.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            }
            let _ = self.mft.cast::<windows::core::IUnknown>();
        }
    }

    /// AudioSpecificConfig for AAC-LC (used if the encoder gives none).
    fn asc_for(sample_rate: u32, channels: u32) -> Vec<u8> {
        let idx: u32 = if sample_rate == 44100 { 4 } else { 3 };
        let v: u16 = ((2u16) << 11) | ((idx as u16) << 7) | ((channels as u16) << 3);
        v.to_be_bytes().to_vec()
    }
}

#[cfg(windows)]
pub use imp::AacEncoder;

#[cfg(not(windows))]
pub struct AacEncoder {
    pub sample_rate: u32,
    pub channels: u32,
    pub asc: Vec<u8>,
}
#[cfg(not(windows))]
impl AacEncoder {
    pub fn new(_sr: u32, _ch: u32, _bps: u32) -> Result<Self, String> {
        Err("AAC encoding needs Windows".into())
    }
    pub fn encode(&mut self, _pcm: &[i16]) -> Result<Vec<Vec<u8>>, String> {
        Ok(Vec::new())
    }
    pub fn finish(&mut self) -> Result<Vec<Vec<u8>>, String> {
        Ok(Vec::new())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::AacEncoder;

    /// Encodes an impulse train to an ADTS file for measuring the encoder delay
    /// (`SONORA_AAC_PROBE=<path>`; decode it with ffmpeg and find the clicks).
    #[test]
    fn impulse_probe() {
        let Ok(path) = std::env::var("SONORA_AAC_PROBE") else { return };
        let sr = 48000u32;
        let mut enc = AacEncoder::new(sr, 2, 24000).expect("encoder");
        let n = sr as usize * 2;
        let mut pcm = vec![0i16; n * 2];
        for k in 0..4 {
            let at = 4800 + k * 12000;
            pcm[at * 2] = 30000;
            pcm[at * 2 + 1] = 30000;
        }
        let mut frames = Vec::new();
        for chunk in pcm.chunks(4800 * 2) {
            frames.extend(enc.encode(chunk).expect("encode"));
        }
        frames.extend(enc.finish().expect("finish"));
        let mut out = Vec::new();
        for f in &frames {
            let len = f.len() + 7;
            // ADTS: MPEG-4, LC, 48 kHz (index 3), 2 channels.
            out.extend_from_slice(&[0xFF, 0xF1, (1 << 6) | (3 << 2), (2 << 6) | ((len >> 11) as u8 & 3), (len >> 3) as u8, (((len & 7) << 5) as u8) | 0x1F, 0xFC]);
            out.extend_from_slice(f);
        }
        std::fs::write(&path, out).expect("write");
        eprintln!("frames {} asc {:02x?}", frames.len(), enc.asc);
    }
}
