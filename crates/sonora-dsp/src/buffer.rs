/// Pre-allocated circular buffer for mono f32 samples.
///
/// `write_one` / `write_slice` never allocate, so the buffer is safe to fill
/// from a real-time audio callback.
pub struct AudioBuffer {
    data: Vec<f32>,
    write_pos: usize,
    new_samples: usize,
    capacity: usize,
}

impl AudioBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            data: vec![0.0; capacity],
            write_pos: 0,
            new_samples: 0,
            capacity,
        }
    }

    /// Write a single mono sample.
    #[inline]
    pub fn write_one(&mut self, sample: f32) {
        self.data[self.write_pos] = sample;
        self.write_pos += 1;
        if self.write_pos == self.capacity {
            self.write_pos = 0;
        }
        if self.new_samples < self.capacity {
            self.new_samples += 1;
        }
    }

    /// Write a block of mono samples.
    pub fn write_slice(&mut self, samples: &[f32]) {
        for &s in samples {
            self.write_one(s);
        }
    }

    /// Number of new samples since the last `read_latest`.
    pub fn new_sample_count(&self) -> usize {
        self.new_samples
    }

    /// Copy the latest `out.len()` samples into `out` (oldest first) and reset
    /// the new-sample counter.
    pub fn read_latest(&mut self, out: &mut [f32]) {
        let count = out.len().min(self.capacity);
        let start = (self.write_pos + self.capacity - count) % self.capacity;
        for (i, o) in out.iter_mut().enumerate().take(count) {
            *o = self.data[(start + i) % self.capacity];
        }
        self.new_samples = 0;
    }

    /// Discard all samples (e.g. on a device switch).
    pub fn clear(&mut self) {
        self.data.iter_mut().for_each(|s| *s = 0.0);
        self.write_pos = 0;
        self.new_samples = 0;
    }
}
