use crate::audio::frame::{Bands, ElementData, Elements};
use crate::audio::onsets::OnsetFrame;

pub struct ElementDetector {
    /// Smoothed element energies for presence tracking.
    kick_smooth: f32,
    snare_smooth: f32,
    hihat_smooth: f32,
    bass_smooth: f32,
    vocal_smooth: f32,
    pad_smooth: f32,
    lead_smooth: f32,
}

impl ElementDetector {
    pub fn new() -> Self {
        Self {
            kick_smooth: 0.0,
            snare_smooth: 0.0,
            hihat_smooth: 0.0,
            bass_smooth: 0.0,
            vocal_smooth: 0.0,
            pad_smooth: 0.0,
            lead_smooth: 0.0,
        }
    }

    pub fn process(
        &mut self,
        bands: &Bands,
        onsets: &OnsetFrame,
        spectral_centroid: f32,
        dt: f32,
    ) -> Elements {
        let fast_attack = 1.0 - (-dt / 0.015).exp();
        let medium_decay = 1.0 - (-dt / 0.12).exp();
        let slow_attack = 1.0 - (-dt / 0.08).exp();
        let slow_decay = 1.0 - (-dt / 0.4).exp();

        // ── Kick: low-frequency transient ──────────────────────
        // Use band energy as a base, onset boosts it
        let kick_base = (bands.sub_bass.energy * 0.5 + bands.bass.energy * 0.5).min(1.0);
        let onset_boost = if onsets.sub_bass.detected || onsets.bass.detected {
            (onsets.sub_bass.strength + onsets.bass.strength).min(1.0)
        } else {
            0.0
        };
        let kick_raw = (kick_base * 0.3 + onset_boost * 0.7).min(1.0);
        self.kick_smooth = smooth(self.kick_smooth, kick_raw, fast_attack, medium_decay);

        // ── Snare: broadband transient in mid/high ─────────────
        let snare_base = (bands.mid.energy * 0.3 + bands.upper_mid.energy * 0.4 + bands.high.energy * 0.3).min(1.0);
        let snare_onset = if onsets.mid.detected || onsets.upper_mid.detected || onsets.high.detected {
            let s = onsets.mid.strength * 0.4 + onsets.upper_mid.strength * 0.3 + onsets.high.strength * 0.3;
            s.min(1.0)
        } else {
            0.0
        };
        let snare_raw = (snare_base * 0.2 + snare_onset * 0.8).min(1.0);
        self.snare_smooth = smooth(self.snare_smooth, snare_raw, fast_attack, medium_decay);

        // ── Hi-hat: high-frequency content ─────────────────────
        // Hi-hats should be very sensitive — any high-frequency energy counts
        let hihat_base = (bands.high.energy * 0.5 + bands.air.energy * 0.5).min(1.0);
        let hihat_onset = if onsets.high.detected || onsets.air.detected {
            (onsets.high.strength * 0.6 + onsets.air.strength * 0.4).min(1.0)
        } else {
            0.0
        };
        let centroid_boost = if spectral_centroid > 0.2 { 1.2 } else { 0.8 };
        let hihat_raw = ((hihat_base * 0.5 + hihat_onset * 0.5) * centroid_boost).min(1.0);
        self.hihat_smooth = smooth(self.hihat_smooth, hihat_raw, fast_attack, medium_decay);

        // ── Bass: sustained low-frequency energy ───────────────
        // Always active when there's low-frequency content, onset reduces it slightly
        let bass_raw = (bands.sub_bass.energy * 0.4 + bands.bass.energy * 0.6).min(1.0);
        self.bass_smooth = smooth(self.bass_smooth, bass_raw, slow_attack, slow_decay);

        // ── Vocal: energy in 250Hz–4kHz ────────────────────────
        let vocal_raw = (bands.low_mid.energy * 0.25 + bands.mid.energy * 0.45 + bands.upper_mid.energy * 0.3).min(1.0);
        self.vocal_smooth = smooth(self.vocal_smooth, vocal_raw, slow_attack, slow_decay);

        // ── Pad: sustained spectral energy, penalize transients ─
        let sustained = bands.mid.energy * 0.3 + bands.low_mid.energy * 0.35 + bands.upper_mid.energy * 0.35;
        let onset_penalty = if onsets.mid.detected || onsets.upper_mid.detected { 0.5 } else { 1.0 };
        let pad_raw = (sustained * onset_penalty).min(1.0);
        self.pad_smooth = smooth(self.pad_smooth, pad_raw, slow_attack, slow_decay);

        // ── Lead: upper-mid peaks, boosted by onsets ───────────
        let lead_energy = bands.upper_mid.energy * 0.5 + bands.high.energy * 0.3 + bands.mid.energy * 0.2;
        let onset_boost_lead = if onsets.upper_mid.detected || onsets.high.detected { 1.3 } else { 1.0 };
        let lead_raw = (lead_energy * onset_boost_lead).min(1.0);
        self.lead_smooth = smooth(self.lead_smooth, lead_raw, slow_attack, slow_decay);

        Elements {
            kick: ElementData {
                presence: if self.kick_smooth > 0.02 { 1.0 } else { 0.0 },
                energy: self.kick_smooth,
            },
            snare: ElementData {
                presence: if self.snare_smooth > 0.02 { 1.0 } else { 0.0 },
                energy: self.snare_smooth,
            },
            hihat: ElementData {
                presence: if self.hihat_smooth > 0.01 { 1.0 } else { 0.0 },
                energy: self.hihat_smooth,
            },
            bass: ElementData {
                presence: if self.bass_smooth > 0.01 { 1.0 } else { 0.0 },
                energy: self.bass_smooth,
            },
            vocal: ElementData {
                presence: if self.vocal_smooth > 0.01 { 1.0 } else { 0.0 },
                energy: self.vocal_smooth,
            },
            pad: ElementData {
                presence: if self.pad_smooth > 0.01 { 1.0 } else { 0.0 },
                energy: self.pad_smooth,
            },
            lead: ElementData {
                presence: if self.lead_smooth > 0.01 { 1.0 } else { 0.0 },
                energy: self.lead_smooth,
            },
        }
    }
}

/// Asymmetric smoothing: fast attack, slower decay.
fn smooth(current: f32, target: f32, attack: f32, decay: f32) -> f32 {
    let alpha = if target > current { attack } else { decay };
    current + alpha * (target - current)
}
