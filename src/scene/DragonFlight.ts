import * as THREE from 'three';
import type { HandSignal } from '../hand/gesture';

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function createMembraneTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const base = ctx.createLinearGradient(0, 0, 512, 512);
  base.addColorStop(0, '#48302c');
  base.addColorStop(.42, '#231719');
  base.addColorStop(1, '#100e12');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  let seed = 0x41d09;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let i = 0; i < 1650; i++) {
    const shade = random() > .5 ? 'rgba(189,136,102,.06)' : 'rgba(5,4,6,.14)';
    ctx.strokeStyle = shade;
    ctx.lineWidth = .35 + random() * 1.3;
    const x = random() * 512, y = random() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (random() - .5) * 18, y + 5 + random() * 18, x + (random() - .5) * 30, y + 8 + random() * 34);
    ctx.stroke();
  }
  for (let i = 0; i < 38; i++) {
    const x = random() * 512, y = random() * 512;
    const veil = ctx.createRadialGradient(x, y, 3, x, y, 42 + random() * 62);
    veil.addColorStop(0, 'rgba(132,68,57,.1)');
    veil.addColorStop(1, 'rgba(36,19,24,0)');
    ctx.fillStyle = veil;
    ctx.fillRect(x - 100, y - 100, 200, 200);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function scaledSphere(
  parent: THREE.Object3D,
  material: THREE.Material,
  position: THREE.Vector3,
  scale: THREE.Vector3,
  geometry = new THREE.SphereGeometry(1, 18, 14),
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.scale.copy(scale);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

/** An original, procedural bat-winged dragon; intentionally not an exact screen-used Drogon replica. */
export class DragonFlight {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private wings: Array<{ group: THREE.Group; side: number; wrist: THREE.Group }> = [];
  private legs: THREE.Group[] = [];
  private tail: THREE.Group[] = [];
  private head = new THREE.Group();
  private flame!: THREE.Mesh;
  private flameMaterial!: THREE.MeshBasicMaterial;
  private embers!: THREE.Points;
  private emberPositions = new Float32Array(144 * 3);
  private emberVelocity: THREE.Vector3[] = [];
  private emberLife = new Float32Array(144);
  private breathRemaining = 0;
  private breathCooldown = 0;
  private emissionCarry = 0;
  private target = new THREE.Vector3();
  private rawTarget = new THREE.Vector3();
  private steeringOffset = new THREE.Vector3();
  private manualControlActive = false;
  private breathTip = new THREE.Vector3();
  private dummy = new THREE.Object3D();

  constructor(private scene: THREE.Scene) {
    this.group.visible = false;
    this.group.scale.setScalar(.91);
    this.scene.add(this.group);
    this.createDragon();
    this.body.scale.set(1.32, 1.29, 1.34);
    this.head.scale.setScalar(1.08);
    this.createBreath();
  }

  private createDragon() {
    const hide = new THREE.MeshStandardMaterial({ color: '#242327', roughness: .68, metalness: .24 });
    const scaleDark = new THREE.MeshStandardMaterial({ color: '#302d30', roughness: .8, metalness: .13, flatShading: true });
    const warmRidge = new THREE.MeshStandardMaterial({ color: '#78463b', roughness: .65, metalness: .18, flatShading: true });
    const hornMat = new THREE.MeshStandardMaterial({ color: '#80715c', roughness: .72, metalness: .18, flatShading: true });
    const membrane = new THREE.MeshStandardMaterial({ color: '#ffffff', map: createMembraneTexture(), roughness: .94, metalness: .02, side: THREE.DoubleSide, transparent: true, opacity: .98 });
    const ribMat = new THREE.LineBasicMaterial({ color: '#715046', transparent: true, opacity: .84 });
    const amber = new THREE.MeshStandardMaterial({ color: '#ffc274', emissive: '#ff5e1d', emissiveIntensity: 4.2, roughness: .2 });
    const ivory = new THREE.MeshStandardMaterial({ color: '#d0b99a', roughness: .55, flatShading: true });

    this.group.add(this.body);
    // Broad rib cage and long, heavy torso.
    scaledSphere(this.body, hide, V(0, 0, -.15), V(.78, .64, 1.9));
    scaledSphere(this.body, scaleDark, V(0, -.14, .82), V(.56, .5, 1.05));
    scaledSphere(this.body, warmRidge, V(0, -.25, .85), V(.42, .42, .94));
    scaledSphere(this.body, hide, V(0, .06, -1.47), V(.58, .54, .78));
    scaledSphere(this.body, warmRidge, V(0, -.16, -1.55), V(.38, .31, .72));

    // Overlapping small plates break up the torso silhouette without expensive texture maps.
    const plates = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.105, 0), scaleDark, 96);
    plates.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    let plateIndex = 0;
    for (let band = 0; band < 8; band++) {
      const z = .93 - band * .36;
      const radius = z > .4 ? .51 : .59;
      for (let arc = 0; arc < 12; arc++) {
        const angle = (arc / 12) * TAU + (band % 2) * .22;
        const x = Math.sin(angle) * radius;
        const y = Math.cos(angle) * radius * .74;
        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(.18 * Math.cos(angle), .1 * Math.sin(angle), angle * .1);
        this.dummy.scale.set(.9 + (arc % 3) * .1, .52, .76);
        this.dummy.updateMatrix();
        plates.setMatrixAt(plateIndex, this.dummy.matrix);
        plates.setColorAt(plateIndex, new THREE.Color().setHSL(.02 + (arc % 3) * .008, .17, .105 + (band % 3) * .012));
        plateIndex++;
      }
    }
    plates.count = plateIndex;
    this.body.add(plates);

    // A serrated spine reads from brow to the base of the tail.
    for (let i = 0; i < 13; i++) {
      const z = 1.2 - i * .3;
      const height = .32 - Math.max(0, i - 8) * .014;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(height * .19, height, 7), i % 3 === 0 ? warmRidge : hide);
      spike.position.set(0, .48 + height * .39, z);
      spike.rotation.x = -.18;
      this.body.add(spike);
    }

    // The chest joins the skull through a short set of tapering, overlapping neck plates.
    const neck = new THREE.Group();
    neck.position.set(0, .08, 1.2);
    this.body.add(neck);
    for (let i = 0; i < 5; i++) {
      const u = i / 4;
      const z = .24 + u * .83;
      scaledSphere(neck, i % 2 ? hide : scaleDark, V(0, .035 + u * .18, z), V(.47 - u * .08, .43 - u * .1, .38));
      const ridge = new THREE.Mesh(new THREE.ConeGeometry(.14 - u * .035, .28 - u * .06, 6), warmRidge);
      ridge.position.set(0, .43 - u * .03, z);
      ridge.rotation.x = -.3;
      neck.add(ridge);
    }

    // Head: heavy brow, angular snout, split lower jaw, swept horns, warm eyes and ivory teeth.
    this.head.position.set(0, .25, 2.42);
    this.body.add(this.head);
    scaledSphere(this.head, hide, V(0, .08, .04), V(.62, .49, .56));
    scaledSphere(this.head, scaleDark, V(0, -.17, .43), V(.46, .26, .52));
    const snout = new THREE.Mesh(new THREE.ConeGeometry(.34, .83, 9), hide);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -.05, .88);
    snout.scale.set(1.2, 1, .85);
    this.head.add(snout);
    const jaw = scaledSphere(this.head, warmRidge, V(0, -.39, .57), V(.4, .11, .49));
    jaw.rotation.x = -.09;
    for (const side of [-1, 1]) {
      scaledSphere(this.head, amber, V(side * .43, .17, .32), V(.125, .095, .075));
      const brow = new THREE.Mesh(new THREE.ConeGeometry(.17, .62, 7), hide);
      brow.position.set(side * .35, .48, -.02);
      brow.rotation.set(-.3, 0, -side * .58);
      this.head.add(brow);
      const rearHorn = new THREE.Mesh(new THREE.ConeGeometry(.12, .86, 7), hornMat);
      rearHorn.position.set(side * .34, .62, -.3);
      rearHorn.rotation.set(-.57, 0, -side * .33);
      this.head.add(rearHorn);
      for (let tooth = 0; tooth < 3; tooth++) {
        const fang = new THREE.Mesh(new THREE.ConeGeometry(.035, .14, 5), ivory);
        fang.rotation.x = Math.PI;
        fang.position.set(side * (.21 + tooth * .07), -.27, .4 + tooth * .22);
        this.head.add(fang);
      }
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(.036, 7, 6), new THREE.MeshBasicMaterial({ color: '#070809' }));
      nostril.position.set(side * .17, .045, 1.31);
      this.head.add(nostril);
    }

    // Four hooked legs; each limb sways slightly with the body and flight cycle.
    for (const z of [.64, -1.32]) {
      for (const side of [-1, 1]) this.legs.push(this.createLeg(side, z, hide, scaleDark, hornMat));
    }

    // A chain of tapering articulated tail links creates visible follow-through on turns.
    const tailRoot = new THREE.Group();
    tailRoot.position.set(0, -.06, -1.82);
    this.body.add(tailRoot);
    let jointParent: THREE.Group = tailRoot;
    for (let i = 0; i < 8; i++) {
      const joint = new THREE.Group();
      if (i > 0) joint.position.z = -.5;
      jointParent.add(joint);
      const radius = .27 * Math.pow(.84, i);
      const link = new THREE.Mesh(new THREE.CylinderGeometry(radius * .78, radius, .68, 9, 1), i % 3 === 0 ? warmRidge : hide);
      link.rotation.x = Math.PI / 2;
      joint.add(link);
      const ridge = new THREE.Mesh(new THREE.ConeGeometry(radius * .34, radius * 1.02, 6), hornMat);
      ridge.position.y = radius * .78;
      joint.add(ridge);
      this.tail.push(joint);
      jointParent = joint;
    }
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(.26, 0), warmRidge);
    tip.scale.set(.42, .7, 1.7);
    tip.position.z = -.45;
    jointParent.add(tip);

    // Broad scalloped membranes with separate finger-like spars and articulated wrists.
    for (const side of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(side * .55, .3, .58);
      wing.scale.set(side / 1.32, 1 / 1.29, 1 / 1.34);
      this.body.add(wing);
      const membraneShape = new THREE.Shape();
      membraneShape.moveTo(0, 0);
      membraneShape.quadraticCurveTo(.75, .7, 1.5, 1.02);
      membraneShape.lineTo(2.6, 1.14);
      membraneShape.lineTo(4.1, .56);
      membraneShape.lineTo(4.82, .02);
      membraneShape.lineTo(4.93, -.54);
      membraneShape.lineTo(4.55, -.88);
      membraneShape.quadraticCurveTo(4.11, -.2, 4.02, -.82);
      membraneShape.lineTo(3.78, -1.65);
      membraneShape.quadraticCurveTo(3.18, -.83, 3.08, -1.47);
      membraneShape.lineTo(2.5, -2.02);
      membraneShape.quadraticCurveTo(2.19, -1.13, 1.88, -1.71);
      membraneShape.lineTo(1.3, -2.02);
      membraneShape.quadraticCurveTo(1.14, -1.12, .5, -1.22);
      membraneShape.lineTo(.08, -1.04);
      membraneShape.closePath();
      const skin = new THREE.Mesh(new THREE.ShapeGeometry(membraneShape, 2), membrane);
      skin.position.z = -.035;
      wing.add(skin);
      const innerSkin = new THREE.Shape();
      innerSkin.moveTo(.12, -.08);
      innerSkin.quadraticCurveTo(.62, .36, 1.48, .73);
      innerSkin.lineTo(2.47, .83);
      innerSkin.lineTo(4.08, .38);
      innerSkin.quadraticCurveTo(3.35, -.08, 3.56, -.92);
      innerSkin.quadraticCurveTo(2.8, -.45, 2.39, -1.48);
      innerSkin.quadraticCurveTo(1.92, -.75, 1.35, -1.5);
      innerSkin.quadraticCurveTo(.83, -.68, .12, -.82);
      innerSkin.closePath();
      const innerMaterial = new THREE.MeshStandardMaterial({ color: '#3d2525', roughness: .98, metalness: .02, side: THREE.DoubleSide, transparent: true, opacity: .34, flatShading: true });
      const innerLayer = new THREE.Mesh(new THREE.ShapeGeometry(innerSkin, 1), innerMaterial);
      innerLayer.position.z = -.022;
      wing.add(innerLayer);
      const ribs = new THREE.BufferGeometry();
      const points = [
        0,0,0, 4.82,.02,0,
        0,0,0, 2.6,1.14,0,
        4.82,.02,0, 3.82,-1.6,0,
        2.6,1.14,0, 2.5,-2.02,0,
        1.45,.72,0, 1.3,-2.02,0,
        .12,-.08,0, .08,-1.04,0,
        .48,.23,.01, 4.1,.56,.01,
      ];
      ribs.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      wing.add(new THREE.LineSegments(ribs, ribMat));
      const wrist = new THREE.Group();
      wrist.position.set(3.7, .48, 0);
      wing.add(wrist);
      for (const clawSign of [-1, 1]) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(.075, .35, 6), hornMat);
        claw.position.set(clawSign * .13, -.11, .04);
        claw.rotation.z = Math.PI;
        wrist.add(claw);
      }
      this.wings.push({ group: wing, side, wrist });
    }
  }

  private createLeg(side: number, z: number, hide: THREE.Material, scale: THREE.Material, claws: THREE.Material) {
    const leg = new THREE.Group();
    leg.position.set(side * .49, -.38, z);
    this.body.add(leg);
    const thigh = scaledSphere(leg, hide, V(side * .1, -.04, 0), V(.26, .4, .34));
    thigh.rotation.z = -side * .24;
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(.11, .19, .46, 8), scale);
    shin.position.set(side * .12, -.36, .04);
    shin.rotation.z = side * .22;
    leg.add(shin);
    const foot = scaledSphere(leg, hide, V(side * .16, -.62, .23), V(.23, .115, .3));
    foot.rotation.y = side * .12;
    for (let i = -1; i <= 1; i++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(.07, .28, 5), claws);
      claw.rotation.x = Math.PI / 3;
      claw.position.set(side * .16 + i * .13, -.69, .45);
      leg.add(claw);
    }
    const plate = scaledSphere(leg, scale, V(side * .29, .16, -.03), V(.1, .23, .22));
    plate.rotation.z = -side * .45;
    return leg;
  }

  private createBreath() {
    this.flameMaterial = new THREE.MeshBasicMaterial({
      color: '#ff6a21', transparent: true, opacity: .86, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(.54, 2.35, 12, 1), this.flameMaterial);
    this.flame.rotation.x = Math.PI / 2;
    this.flame.position.set(0, -.1, 1.83);
    this.flame.visible = false;
    this.head.add(this.flame);
    this.embers = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: '#ffad42', size: .12, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.emberVelocity = Array.from({ length: this.emberLife.length }, () => new THREE.Vector3());
    this.emberPositions.fill(0);
    for (let i = 0; i < this.emberLife.length; i++) this.emberPositions[i * 3 + 1] = -1000;
    this.embers.geometry.setAttribute('position', new THREE.BufferAttribute(this.emberPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.scene.add(this.embers);
    this.embers.visible = false;
  }

  beginBreath() {
    if (this.breathCooldown > 0) return;
    this.breathRemaining = .78;
    this.breathCooldown = 1.05;
  }

  update(dt: number, time: number, control: HandSignal | null, mouseTarget: THREE.Vector3 | null, fire = false) {
    if (!this.group.visible) return;
    if (fire) this.beginBreath();
    this.breathCooldown = Math.max(0, this.breathCooldown - dt);
    this.breathRemaining = Math.max(0, this.breathRemaining - dt);

    const glideX = Math.sin(time * .47) * .42;
    const glideY = Math.sin(time * .73) * .2 + Math.sin(time * .31) * .12;
    const rawX = control ? (control.x - .5) * 6.3 : mouseTarget ? clamp(mouseTarget.x * .62, -4.1, 4.1) : glideX;
    const rawY = control ? (.5 - control.y) * 2.55 + (control.depth - .5) * 1.2 : mouseTarget ? clamp(mouseTarget.y * .6, -2.1, 2.1) : glideY;
    const rawZ = control ? (control.depth - .5) * 1.2 : 0;
    this.manualControlActive = Boolean(control || mouseTarget);
    this.rawTarget.set(rawX, rawY, rawZ);
    this.target.copy(this.rawTarget);
    if (this.manualControlActive) this.target.add(this.steeringOffset);
    const follow = 1 - Math.exp(-dt * 2.9);
    this.group.position.x += (this.target.x - this.group.position.x) * follow;
    this.group.position.y += (this.target.y - this.group.position.y) * follow;
    this.group.position.z += (this.target.z + Math.sin(time * .9) * .14 - this.group.position.z) * follow;

    const lean = control?.roll ?? 0;
    this.body.rotation.z += (clamp(-this.target.x * .027 + lean * .38, -.42, .42) - this.body.rotation.z) * (1 - Math.exp(-dt * 2.5));
    this.body.rotation.x = Math.sin(time * .68) * .035 + (control?.pose === 'fist' ? -.14 : 0);
    this.head.rotation.y = Math.sin(time * .62) * .04 + (control ? clamp((control.x - .5) * .16, -.11, .11) : 0);
    this.head.rotation.x = Math.sin(time * 1.1) * .035 + (control?.pose === 'fist' ? .11 : 0);

    const wingbeat = Math.sin(time * 4.05);
    for (const wing of this.wings) {
      const flap = wing.side * (.2 + wingbeat * .54);
      wing.group.rotation.z += (flap - wing.group.rotation.z) * (1 - Math.exp(-dt * 10));
      wing.group.rotation.y = wing.side * (.06 + Math.sin(time * 2.03 + .45) * .08);
      wing.wrist.rotation.z = wing.side * (Math.sin(time * 4.05 - .65) * .23 - .08);
    }
    this.tail.forEach((joint, index) => {
      const falloff = index / this.tail.length;
      joint.rotation.y = Math.sin(time * 2.05 - index * .47) * (.06 + falloff * .075) + (control?.roll ?? 0) * falloff * .08;
      joint.rotation.x = Math.sin(time * 1.55 - index * .4) * .045;
    });
    this.legs.forEach((leg, index) => {
      leg.rotation.x = Math.sin(time * 4.05 + index * 1.2) * .07;
      leg.rotation.z = Math.sin(time * 2.03 + index) * .025;
    });

    this.updateBreath(dt);
  }

  private updateBreath(dt: number) {
    const breathing = this.breathRemaining > 0;
    this.flame.visible = breathing;
    if (breathing) {
      const envelope = Math.sin((1 - this.breathRemaining / .78) * Math.PI);
      const flicker = .84 + Math.random() * .18;
      this.flame.scale.set(.58 + envelope * .47, .58 + envelope * .45, .74 + envelope * .54);
      this.flameMaterial.opacity = (.22 + envelope * .72) * flicker;
      this.emissionCarry += dt * 115;
      let created = 0;
      while (this.emissionCarry >= 1 && created < 12) {
        this.emissionCarry -= 1;
        const index = this.emberLife.findIndex(life => life <= 0);
        if (index < 0) break;
        this.emberLife[index] = .28 + Math.random() * .48;
        this.emberPositions[index * 3] = this.group.position.x + (Math.random() - .5) * .42;
        this.emberPositions[index * 3 + 1] = this.group.position.y - .05 + (Math.random() - .5) * .36;
        this.emberPositions[index * 3 + 2] = this.group.position.z + 3.5;
        this.emberVelocity[index].set((Math.random() - .5) * 1.9, (Math.random() - .35) * 1.2, 4 + Math.random() * 2.5);
        created++;
      }
    }

    let active = 0;
    for (let i = 0; i < this.emberLife.length; i++) {
      if (this.emberLife[i] <= 0) continue;
      this.emberLife[i] -= dt;
      this.emberPositions[i * 3] += this.emberVelocity[i].x * dt;
      this.emberPositions[i * 3 + 1] += this.emberVelocity[i].y * dt;
      this.emberPositions[i * 3 + 2] += this.emberVelocity[i].z * dt;
      this.emberVelocity[i].multiplyScalar(Math.exp(-dt * 1.15));
      if (this.emberLife[i] <= 0) this.emberPositions[i * 3 + 1] = -1000;
      active++;
    }
    this.embers.visible = active > 0;
    this.embers.geometry.setDrawRange(0, this.emberLife.length);
    (this.embers.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  setVisible(value: boolean) {
    this.group.visible = value;
    this.embers.visible = value && this.emberLife.some(life => life > 0);
    if (!value) {
      this.breathRemaining = 0;
      this.flame.visible = false;
    }
  }

  recenter() {
    if (this.manualControlActive) this.steeringOffset.copy(this.rawTarget).negate();
    else this.steeringOffset.set(0, 0, 0);
    this.target.set(0, 0, 0);
    this.group.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.tail.forEach(joint => joint.rotation.set(0, 0, 0));
    this.breathRemaining = 0;
    this.breathCooldown = 0;
    this.emberLife.fill(0);
    for (let i = 0; i < this.emberLife.length; i++) this.emberPositions[i * 3 + 1] = -1000;
    this.flame.visible = false;
    this.embers.visible = false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.embers);
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
        else object.material.dispose();
      }
    });
    this.embers.geometry.dispose();
    (this.embers.material as THREE.Material).dispose();
  }
}
