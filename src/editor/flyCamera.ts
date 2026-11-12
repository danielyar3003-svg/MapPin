import * as THREE from 'three';

/** Свободный полёт: ПКМ — обзор, WASD — движение, Q/E — вниз/вверх, Shift — быстрее. Ось Z вверх. */
export class FlyCamera {
  yaw = Math.PI / 4;
  pitch = -0.3;
  speed = 40;
  private keys = new Set<string>();
  private looking = false;

  constructor(readonly camera: THREE.PerspectiveCamera, readonly dom: HTMLElement) {
    camera.up.set(0, 0, 1);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { this.looking = true; dom.setPointerCapture(e.pointerId); }
    });
    dom.addEventListener('pointerup', (e) => {
      if (e.button === 2) { this.looking = false; dom.releasePointerCapture(e.pointerId); }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.looking) return;
      this.yaw -= e.movementX * 0.003;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.003, -1.55, 1.55);
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.looking) return;
      e.preventDefault();
      this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 2, 2000);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.looking = false; });
  }

  get isLooking() { return this.looking; }

  direction(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.pitch) * Math.cos(this.yaw), Math.cos(this.pitch) * Math.sin(this.yaw), Math.sin(this.pitch));
  }

  lookAt(target: THREE.Vector3) {
    const d = target.clone().sub(this.camera.position);
    if (d.lengthSq() < 1e-6) return;
    d.normalize();
    this.yaw = Math.atan2(d.y, d.x);
    this.pitch = Math.asin(THREE.MathUtils.clamp(d.z, -1, 1));
  }

  update(dt: number) {
    const fwd = this.direction();
    const right = new THREE.Vector3(Math.sin(this.yaw), -Math.cos(this.yaw), 0);
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(fwd);
    if (this.keys.has('KeyS')) move.sub(fwd);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    if (this.keys.has('KeyE') || this.keys.has('Space')) move.z += 1;
    if (this.keys.has('KeyQ')) move.z -= 1;
    // WASD двигают камеру только при зажатой ПКМ, чтобы не мешать горячим клавишам.
    if (move.lengthSq() > 0 && this.looking) {
      const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
      this.camera.position.addScaledVector(move.normalize(), this.speed * boost * dt);
    }
    this.camera.lookAt(this.camera.position.clone().add(fwd));
  }
}

export function isTyping(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
