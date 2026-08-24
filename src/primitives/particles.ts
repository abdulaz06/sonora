/**
 * Particle system — instanced rendering of small particles.
 * Minimal ambient effect: sparse mist + small bursts on transients.
 */

const MAX_PARTICLES = 200;
const FLOATS_PER_INSTANCE = 7; // x, y, size, alpha, r, g, b

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  /** GPU instance data: [x, y, size, alpha, r, g, b] per particle. */
  instanceData: Float32Array;
  /** Number of live particles this frame. */
  liveCount = 0;

  constructor() {
    this.instanceData = new Float32Array(MAX_PARTICLES * FLOATS_PER_INSTANCE);
  }

  /** Spawn a burst of particles (e.g. on snare/kick hit). */
  burst(count: number, cx: number, cy: number, speed: number, color: [number, number, number]): void {
    const capped = Math.min(count, 6); // very few per burst
    for (let i = 0; i < capped; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const angle = Math.random() * Math.PI * 2;
      const spd = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 0.05,
        y: cy + (Math.random() - 0.5) * 0.05,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0.6 + Math.random() * 1.2,
        maxLife: 0.6 + Math.random() * 1.2,
        size: 0.001 + Math.random() * 0.002,
        r: color[0] + (Math.random() - 0.5) * 0.1,
        g: color[1] + (Math.random() - 0.5) * 0.1,
        b: color[2] + (Math.random() - 0.5) * 0.1,
      });
    }
  }

  /** Spawn ambient mist particles (continuous, driven by hi-hat/energy). */
  spawnMist(rate: number, dt: number): void {
    // Very sparse: at most 1-2 per frame even at high energy
    const count = Math.floor(rate * dt * 10);
    for (let i = 0; i < Math.min(count, 2); i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const angle = Math.random() * Math.PI * 2;
      const dist = 0.2 + Math.random() * 0.6;
      this.particles.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.015,
        vy: (Math.random() - 0.5) * 0.015 + 0.008,
        life: 1.0 + Math.random() * 2.0,
        maxLife: 1.0 + Math.random() * 2.0,
        size: 0.0005 + Math.random() * 0.0015,
        r: 0.5 + Math.random() * 0.3,
        g: 0.7 + Math.random() * 0.2,
        b: 0.9 + Math.random() * 0.1,
      });
    }
  }

  /** Update all particles and write GPU instance buffer. */
  update(dt: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;

      if (writeIdx !== i) {
        this.particles[writeIdx] = p;
      }
      writeIdx++;
    }
    this.particles.length = writeIdx;
    this.liveCount = writeIdx;

    for (let i = 0; i < this.liveCount; i++) {
      const p = this.particles[i];
      const lifeRatio = p.life / p.maxLife;
      const alpha = lifeRatio * lifeRatio;
      const off = i * FLOATS_PER_INSTANCE;
      this.instanceData[off    ] = p.x;
      this.instanceData[off + 1] = p.y;
      this.instanceData[off + 2] = p.size * (1.0 + (1.0 - lifeRatio) * 0.5);
      this.instanceData[off + 3] = alpha;
      this.instanceData[off + 4] = p.r;
      this.instanceData[off + 5] = p.g;
      this.instanceData[off + 6] = p.b;
    }
  }
}
