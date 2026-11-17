//! DSP checks on synthetic signals: silence, tones in the right band, a kick
//! train locking the tempo and producing onsets, and loud vs quiet intensity.

use sonora_dsp::{AudioFeatureFrame, StreamAnalyzer};

const SR: u32 = 44_100;

/// Run `seconds` of a generated signal through the analyser; return every frame.
fn run(seconds: f32, mut sample: impl FnMut(f32) -> f32) -> Vec<AudioFeatureFrame> {
    let mut a = StreamAnalyzer::new(SR);
    let n = (seconds * SR as f32) as usize;
    let mut out = Vec::new();
    let hop = a.hop();
    let mut buf = Vec::with_capacity(hop);
    for i in 0..n {
        buf.push(sample(i as f32 / SR as f32));
        if buf.len() == hop {
            a.push(&buf);
            buf.clear();
            while let Some(f) = a.next_frame() {
                out.push(f);
            }
        }
    }
    out
}

/// A decaying 55 Hz sine thump every beat at `bpm`.
fn kick(t: f32, bpm: f32) -> f32 {
    let beat = 60.0 / bpm;
    let k = t % beat;
    let env = (-k * 28.0).exp();
    let f = 55.0 + 90.0 * (-k * 40.0).exp();
    0.9 * env * (2.0 * std::f32::consts::PI * f * k).sin()
}

#[test]
fn silence_stays_quiet() {
    let frames = run(6.0, |_| 0.0);
    let last = frames.last().expect("frames");
    assert!(last.intensity < 0.05, "intensity {}", last.intensity);
    assert!(frames.iter().all(|f| !f.beat.onset), "no onsets in silence");
}

#[test]
fn bass_tone_is_bass_and_hiss_is_high() {
    let low = run(4.0, |t| 0.5 * (2.0 * std::f32::consts::PI * 70.0 * t).sin());
    let f = low.last().unwrap();
    assert!(f.bands.bass.energy + f.bands.sub_bass.energy > f.bands.high.energy + f.bands.air.energy);

    let mut seed = 12345u32;
    let high = run(4.0, move |t| {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let noise = (seed >> 9) as f32 / (1u32 << 23) as f32 - 1.0;
        0.3 * noise * (2.0 * std::f32::consts::PI * 9000.0 * t).sin()
    });
    let f = high.last().unwrap();
    assert!(f.bands.high.energy + f.bands.air.energy > f.bands.bass.energy + f.bands.sub_bass.energy);
}

#[test]
fn kick_train_locks_tempo_and_fires_onsets() {
    let frames = run(20.0, |t| kick(t, 124.0));
    let onsets = frames.iter().filter(|f| f.beat.onset).count();
    // 20 s at 124 BPM ≈ 41 kicks; the tracker needs a few beats to lock.
    assert!(onsets >= 25, "only {onsets} onsets");
    let last = frames.last().unwrap();
    let bpm = last.beat.bpm;
    // Half / double time are acceptable readings of the same pulse.
    let ok = [62.0, 124.0, 248.0].iter().any(|b| (bpm - b).abs() < 3.0);
    assert!(ok, "bpm {bpm}");
    assert!(last.beat.confidence > 0.3, "confidence {}", last.beat.confidence);
}

#[test]
fn louder_music_is_more_intense() {
    let quiet = run(10.0, |t| 0.08 * kick(t, 120.0));
    let loud = run(10.0, |t| kick(t, 120.0) + 0.2 * (2.0 * std::f32::consts::PI * 220.0 * t).sin());
    let avg = |v: &[AudioFeatureFrame]| v[v.len() - 120..].iter().map(|f| f.energy.instant).sum::<f32>() / 120.0;
    assert!(avg(&loud) > avg(&quiet) * 2.0, "loud {} quiet {}", avg(&loud), avg(&quiet));
}
