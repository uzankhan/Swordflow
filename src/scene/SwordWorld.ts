import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Formation, HandSignal, Pose } from '../hand/gesture';
import { DragonFlight } from './DragonFlight';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const GRID_CELL = .62;
const GRID_X = 24, GRID_Y = 18, GRID_Z = 24;
const GRID_CELLS = GRID_X * GRID_Y * GRID_Z;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Blade {
  p: THREE.Vector3; v: THREE.Vector3; q: THREE.Quaternion; target: THREE.Vector3;
  seed: number; scale: number; flight: number; ttl: number; volleyId: number;
}
interface Gate { group: THREE.Group; center: THREE.Vector3; ring: THREE.Mesh; }

export class SwordWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private dragon: DragonFlight;
  private root = new THREE.Group();
  private bladeMesh!: THREE.InstancedMesh;
  private blades: Blade[] = [];
  private gates: Gate[] = [];
  private volleySequence = 0;
  private pendingVolleys = new Map<number,{remaining:number;hits:number}>();
  private onImpact: (hit:boolean)=>void = () => {};
  private sparks!: THREE.Points;
  private sparkPositions = new Float32Array(360 * 3);
  private sparkVel: THREE.Vector3[] = [];
  private sparkLife = new Float32Array(360);
  private trails!: THREE.LineSegments;
  private trailPositions = new Float32Array(420 * 6);
  private lastBladePositions: THREE.Vector3[] = [];
  private rings: THREE.Mesh[] = [];
  private ringLives = new Float32Array(16);
  private stars!: THREE.Points;
  private floorShadow!: THREE.Mesh;
  private dummy = new THREE.Object3D();
  private neighborHeads = new Int16Array(GRID_CELLS);
  private neighborNext = new Int16Array(440);
  private temp = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private accel = new THREE.Vector3();
  private separation = new THREE.Vector3();
  private alignmentForce = new THREE.Vector3();
  private radial = new THREE.Vector3();
  private facing = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private alignment = new THREE.Quaternion();
  private rollAlignment = new THREE.Quaternion();
  private zAxis = new THREE.Vector3(0,0,1);
  private center = new THREE.Vector3();
  private target = new THREE.Vector3();
  private pointerTarget = new THREE.Vector3(0, 0, 0);
  private hand: HandSignal | null = null;
  private handPose: Pose = 'lost';
  private formation: Formation = 'orbit';
  private compact = 0;
  private charge = 0;
  private mode: 'idle' | 'mouse' | 'hand' = 'idle';
  private paused = false;
  private sensitivity = 0.68;
  private quality: 'auto' | 'high' | 'balanced' | 'low' = 'auto';
  private flightMode: 'swarm' | 'dragon' = 'swarm';
  private dragonFireRequested = false;
  private bladeCount = 190;
  private autoReduced = false;
  private lowFpsSamples = 0;
  private highFpsSamples = 0;
  private lowPowerProfile: boolean;
  private softwareRenderer = false;
  private last = 0; private raf = 0; private elapsed = 0;
  private fpsFrames = 0; private fpsStart = 0; private fps = 0;
  private onFps: (fps: number) => void;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private resizeObserver: ResizeObserver;
  private onVisibilityChange = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.last = 0;
      return;
    }
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick);
  };

  constructor(private canvas: HTMLCanvasElement, onFps: (fps: number) => void) {
    this.onFps = onFps;
    const touchDevice = matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 720px)').matches;
    const cpuCores = navigator.hardwareConcurrency || 4;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    this.lowPowerProfile = touchDevice || cpuCores <= 4 || (memory !== undefined && memory <= 4);
    this.autoReduced = false;
    this.bladeCount = this.lowPowerProfile ? 140 : 200;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    try {
      const gl = this.renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererName = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)).toLowerCase() : '';
      this.softwareRenderer = /swiftshader|llvmpipe|softpipe|software renderer/.test(rendererName);
    } catch {
      this.softwareRenderer = false;
    }
    if (this.softwareRenderer) {
      this.lowPowerProfile = true;
      this.autoReduced = true;
      this.bladeCount = 52;
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.softwareRenderer ? .58 : this.lowPowerProfile ? 1.0 : 1.2));
    this.dragon = new DragonFlight(this.scene);
    this.scene.background = new THREE.Color('#080a0d'); this.scene.fog = new THREE.FogExp2('#080a0d', 0.024);
    this.camera.position.set(0, 0, 14.4); this.camera.lookAt(0, 0, -0.5);
    this.scene.add(new THREE.HemisphereLight('#c1d3e0', '#281c19', 1.55));
    const key = new THREE.DirectionalLight('#fff0d5', 3.4); key.position.set(-3, 5, 8); this.scene.add(key);
    const rim = new THREE.PointLight('#b75139', 30, 23); rim.position.set(4, 1, -2); this.scene.add(rim);
    const fill = new THREE.PointLight('#8fa5b8', 18, 20); fill.position.set(-5, 2, 2); this.scene.add(fill);
    this.scene.add(this.root);
    this.makeAtmosphere(); this.makeGates(); this.makeSparks(); this.makeShockRings(); this.makeSwarm();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas.parentElement ?? canvas);
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  private makeAtmosphere() {
    const n = this.softwareRenderer ? 260 : this.lowPowerProfile ? 560 : 1100; const p = new Float32Array(n * 3); const colors = new Float32Array(n * 3);
    for (let i=0;i<n;i++) { p[i*3]=(Math.random()-.5)*31; p[i*3+1]=(Math.random()-.5)*18; p[i*3+2]=-12-Math.random()*28; const hot=Math.random()>.89; colors[i*3]=hot?.96:.38; colors[i*3+1]=hot?.48:.47; colors[i*3+2]=hot?.26:.52; }
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(p,3)); geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    this.stars=new THREE.Points(geo,new THREE.PointsMaterial({size:.028,vertexColors:true,transparent:true,opacity:.75,depthWrite:false})); this.scene.add(this.stars);
    const ringMat = new THREE.MeshBasicMaterial({color:'#8d6246',transparent:true,opacity:.13,side:THREE.DoubleSide});
    for (let i=0;i<3;i++) { const ring=new THREE.Mesh(new THREE.TorusGeometry(4.2+i*.92,.006,3,220),ringMat); ring.position.z=-4-i*.35; ring.rotation.z=i%2?.18:-.12; this.scene.add(ring); }
    const floor=new THREE.GridHelper(54,48,'#704536','#332d2b'); floor.position.set(0,-5,-4); (floor.material as THREE.Material).transparent=true; (floor.material as THREE.Material).opacity=.16; this.scene.add(floor);
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;const shadowContext=shadowCanvas.getContext('2d');
    if(shadowContext){const gradient=shadowContext.createRadialGradient(64,64,8,64,64,63);gradient.addColorStop(0,'rgba(0,0,0,.46)');gradient.addColorStop(.55,'rgba(0,0,0,.21)');gradient.addColorStop(1,'rgba(0,0,0,0)');shadowContext.fillStyle=gradient;shadowContext.fillRect(0,0,128,128);}
    const shadowTexture=new THREE.CanvasTexture(shadowCanvas);shadowTexture.colorSpace=THREE.SRGBColorSpace;
    this.floorShadow=new THREE.Mesh(new THREE.PlaneGeometry(11,5.4),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,opacity:.72,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
    this.floorShadow.rotation.x=-Math.PI/2;this.floorShadow.position.set(0,-4.96,-3.8);this.floorShadow.renderOrder=1;this.scene.add(this.floorShadow);
    const core = new THREE.Mesh(new THREE.CircleGeometry(.075,32), new THREE.MeshBasicMaterial({color:'#ffd6a0',transparent:true,opacity:.88})); core.position.set(0,0,-4.8); this.root.add(core);
  }

  private makeGates() {
    const positions=[new THREE.Vector3(-4.1,1.45,-6.5),new THREE.Vector3(0,2.5,-7),new THREE.Vector3(4.1,1.45,-6.5)];
    positions.forEach((p,i)=>{
      const group=new THREE.Group(); group.position.copy(p); group.rotation.y=(i-1)*-.12;
      const outer=new THREE.Mesh(new THREE.TorusGeometry(.63,.025,8,72),new THREE.MeshBasicMaterial({color:i===1?'#e2a56e':'#a74637',transparent:true,opacity:.68}));
      const inner=new THREE.Mesh(new THREE.TorusGeometry(.49,.008,5,64),new THREE.MeshBasicMaterial({color:'#deb48d',transparent:true,opacity:.28})); inner.rotation.z=Math.PI/5;
      const halo=new THREE.Mesh(new THREE.RingGeometry(.69,.73,72),new THREE.MeshBasicMaterial({color:'#7b302b',transparent:true,opacity:.2,side:THREE.DoubleSide}));
      group.add(outer,inner,halo); this.scene.add(group); this.gates.push({group,center:p.clone(),ring:outer});
    });
  }

  private makeSparks() {
    for(let i=0;i<360;i++) { this.sparkPositions[i*3+1]=-80; this.sparkVel.push(new THREE.Vector3()); }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(this.sparkPositions,3).setUsage(THREE.DynamicDrawUsage));
    this.sparks=new THREE.Points(g,new THREE.PointsMaterial({color:'#ffb36e',size:.045,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false})); this.scene.add(this.sparks);
  }

  private makeShockRings() {
    const mat=new THREE.MeshBasicMaterial({color:'#ff9860',transparent:true,opacity:.75,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
    for(let i=0;i<16;i++){ const ring=new THREE.Mesh(new THREE.TorusGeometry(.5,.018,6,48),mat.clone()); ring.visible=false; this.scene.add(ring); this.rings.push(ring); }
  }

  private makeSwarm() {
    const shape=new THREE.Shape(); shape.moveTo(-.055,0); shape.lineTo(-.064,.16); shape.lineTo(-.048,.84); shape.lineTo(-.027,1.04); shape.lineTo(0,1.19); shape.lineTo(.027,1.04); shape.lineTo(.048,.84); shape.lineTo(.064,.16); shape.lineTo(.055,0); shape.closePath();
    const bladeGeo=new THREE.ExtrudeGeometry(shape,{depth:.034,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.008,bevelThickness:.008}); bladeGeo.translate(0,0,-.017); bladeGeo.computeVertexNormals();
    const guardShape=new THREE.Shape(); guardShape.moveTo(-.23,-.015); guardShape.quadraticCurveTo(-.12,.015,0,.035); guardShape.quadraticCurveTo(.12,.015,.23,-.015); guardShape.lineTo(.19,-.07); guardShape.quadraticCurveTo(0,-.015,-.19,-.07); guardShape.closePath();
    const guardGeo=new THREE.ExtrudeGeometry(guardShape,{depth:.075,bevelEnabled:true,bevelSegments:2,bevelSize:.014,bevelThickness:.012}); guardGeo.translate(0,0,-.0375);
    const gripGeo=new THREE.CylinderGeometry(.027,.035,.29,8); gripGeo.translate(0,-.18,0);
    const pommelGeo=new THREE.SphereGeometry(.058,12,10); pommelGeo.translate(0,-.35,0);
    const tint=(geometry:THREE.BufferGeometry,hex:string)=>{const c=new THREE.Color(hex);const count=geometry.getAttribute('position').count;const colors=new Float32Array(count*3);for(let i=0;i<count;i++){colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b;}geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));};
    tint(bladeGeo,'#c8d0d0');tint(guardGeo,'#c28762');tint(gripGeo,'#49413b');tint(pommelGeo,'#ca875c');
    const unindexed=(geometry:THREE.BufferGeometry)=>geometry.index?geometry.toNonIndexed():geometry;
    const swordGeo=mergeGeometries([bladeGeo,guardGeo,gripGeo,pommelGeo].map(unindexed),false);
    if(!swordGeo)throw new Error('Could not assemble sword geometry');
    swordGeo.computeBoundingSphere();
    const steel=new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,metalness:.76,roughness:.3,side:THREE.DoubleSide});
    const capacity=440;
    this.bladeMesh=new THREE.InstancedMesh(swordGeo,steel,capacity); this.bladeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.bladeMesh.frustumCulled=false; this.root.add(this.bladeMesh);
    this.bladeMesh.castShadow=false; this.bladeMesh.receiveShadow=false;
    for(let i=0;i<capacity;i++){ const angle=i*2.399963; const r=2+Math.sqrt((i+.5)/capacity)*1.2; const p=new THREE.Vector3(Math.cos(angle)*r,Math.sin(angle)*r*.68,(Math.random()-.5)*2); this.blades.push({p,v:new THREE.Vector3(),q:new THREE.Quaternion(),target:new THREE.Vector3(),seed:Math.random()*TAU,scale:.68+Math.random()*.26,flight:0,ttl:0,volleyId:0}); this.lastBladePositions.push(p.clone()); }
    this.bladeMesh.count=this.bladeCount;
    this.trails=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#d99161',transparent:true,opacity:.22,blending:THREE.AdditiveBlending,depthWrite:false}));
    this.trails.geometry.setAttribute('position',new THREE.BufferAttribute(this.trailPositions,3).setUsage(THREE.DynamicDrawUsage)); this.trails.geometry.setDrawRange(0,0); this.scene.add(this.trails);
  }

  private resize = () => { const host=this.canvas.parentElement??this.canvas; const w=Math.max(1,host.clientWidth), h=Math.max(1,host.clientHeight); this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); };
  setMode(mode:'idle'|'mouse'|'hand'){this.mode=mode; if(mode==='idle')this.hand=null;}
  setFlightMode(mode:'swarm'|'dragon'){
    if(this.flightMode===mode)return;
    this.flightMode=mode;
    const swarm=mode==='swarm';
    this.dragon.setVisible(!swarm);
    this.bladeMesh.visible=swarm;
    this.trails.visible=swarm;
    this.sparks.visible=swarm;
    this.gates.forEach(gate=>{gate.group.visible=swarm;});
    if(!swarm){this.recall();this.rings.forEach(ring=>{ring.visible=false;});}
  }
  getFlightMode(){return this.flightMode;}
  triggerDragonBreath(){if(!this.paused&&this.flightMode==='dragon')this.dragonFireRequested=true;}
  resetDragon(){this.dragon.recenter();}
  setHand(signal:HandSignal|null){this.hand=signal;this.handPose=signal?.pose??'lost';}
  setImpactHandler(handler:(hit:boolean)=>void){this.onImpact=handler;}
  setFormation(value:Formation){this.formation=value;}
  getFormation(){return this.formation;}
  setSensitivity(value:number){this.sensitivity=clamp(value,.3,1);}
  setQuality(value:'auto'|'high'|'balanced'|'low') {
    this.quality=value; this.lowFpsSamples=0; this.highFpsSamples=0; this.autoReduced=false;
    const ratio=value==='high'?1.35:value==='low'?.72:value==='balanced'?1.05:value==='auto'&&this.softwareRenderer?.58:this.lowPowerProfile?1.0:1.2;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,ratio));
    this.setBladeCount(value==='low'?65:value==='balanced'?130:value==='high'?260:value==='auto'&&this.softwareRenderer?52:this.lowPowerProfile?140:200);
    if(value==='auto')this.autoReduced=this.softwareRenderer;
  }
  private setBladeCount(count:number){this.bladeCount=count;this.bladeMesh.count=count;}
  private adaptQuality(){
    if(this.quality!=='auto')return;
    if(this.fps<38){this.lowFpsSamples++;this.highFpsSamples=0;}else if(this.fps>52){this.highFpsSamples++;this.lowFpsSamples=0;}else{this.lowFpsSamples=0;this.highFpsSamples=0;}
    if(!this.autoReduced&&this.lowFpsSamples>=2){this.autoReduced=true;this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,this.softwareRenderer?.58:.88));this.setBladeCount(this.softwareRenderer?52:this.lowPowerProfile?95:125);this.lowFpsSamples=0;}
    else if(this.autoReduced&&this.highFpsSamples>=5){this.autoReduced=false;this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,this.softwareRenderer?.7:this.lowPowerProfile?1.0:1.2));this.setBladeCount(this.softwareRenderer?64:this.lowPowerProfile?140:200);this.highFpsSamples=0;}
  }
  setPaused(value:boolean){this.paused=value;if(value)this.dragonFireRequested=false;}
  getPaused(){return this.paused;}
  steerMouse(x:number,y:number){this.mode='mouse';const w=9.2*this.camera.aspect;this.pointerTarget.set((x-.5)*w,(.5-y)*6.1,1.1);}

  private baseCenter(dt:number) {
    if(this.hand){const width=9.2*this.camera.aspect,gain=this.sensitivity/.68; this.target.set((this.hand.x-.5)*width*gain,(.5-this.hand.y)*6.1*gain,(this.hand.depth*1.6-.3)*gain);}
    else if(this.mode==='mouse') this.target.copy(this.pointerTarget);
    else this.target.set(Math.sin(this.elapsed*.23)*.32,Math.cos(this.elapsed*.3)*.2,.15);
    this.center.lerp(this.target,1-Math.exp(-dt*7.2));
    return this.center;
  }

  private formationPoint(i:number,n:number,t:number,out:THREE.Vector3) {
    const u=i/n, phi=i*2.399963 + t*.22, pulse=Math.sin(t*1.1+i*.07)*.05;
    let x=0,y=0,z=0; const gather=this.handPose==='open'?.72:1;const compact=(1-this.compact*.52)*(this.handPose==='pinch'?.7:1)*gather;
    if(this.formation==='halo') { const a=u*TAU+t*.12; const r=(2.05+pulse)*compact; x=Math.cos(a)*r; y=Math.sin(a)*r*.75; z=Math.sin(a*2+t*.4)*.34; }
    else if(this.formation==='spiral') { const a=phi*1.65; const r=(.65+Math.sqrt(u)*2.35)*compact; x=Math.cos(a)*r; y=(u-.5)*3.15*compact; z=Math.sin(a)*r*.3; }
    else if(this.formation==='shield') { const cols=20, rows=Math.ceil(n/cols); const col=i%cols, row=Math.floor(i/cols); x=(col-(cols-1)/2)*.28*compact; y=((rows-1)/2-row)*.25*compact; z=-.68+Math.sin(col*.55+row*.32+t*.7)*.14; }
    else if(this.formation==='spearhead') { const row=Math.floor(Math.sqrt(u*n)); const side=i%(row+1); const sign=side%2?1:-1; const lane=Math.ceil(side/2); x=sign*lane*.27*compact; y=1.45-row*.22*compact; z=Math.sin(i*.5+t)*.12; }
    else { const a=phi; const r=(1.15+Math.sqrt(u)*2.35)*compact; x=Math.cos(a)*r; y=Math.sin(a)*r*.65; z=Math.sin(i*1.71+t*.55)*(.3+u*.5); }
    const sway=Math.sin(t*1.4+i*.21)*.065; return out.set(x+sway,y+Math.cos(t+i*.18)*.05,z);
  }

  launch(direction={x:0,y:0}) {
    if(this.paused||this.flightMode!=='swarm')return null;
    const n=Math.min(18,this.bladeCount); const center=this.center;
    const candidates=this.blades.slice(0,this.bladeCount).map((b,i)=>({i,d:b.p.distanceToSquared(center),available:b.flight===0})).filter(item=>item.available).sort((a,b)=>a.d-b.d).slice(0,n);
    if(!candidates.length)return null;
    const aim=new THREE.Vector3(direction.x*1.2,direction.y*1.2,-1).normalize();
    const origin=center.clone(); const desired=origin.clone().add(aim.clone().multiplyScalar(5));
    let gate=this.gates[0]; for(const g of this.gates) if(g.center.distanceToSquared(desired)<gate.center.distanceToSquared(desired)) gate=g;
    const base=gate.center.clone().sub(origin).normalize();
    const volleyId=++this.volleySequence;this.pendingVolleys.set(volleyId,{remaining:candidates.length,hits:0});
    candidates.forEach((c,j)=>{const b=this.blades[c.i]; const s=(j-(n-1)/2)/n; b.target.copy(gate.center);b.volleyId=volleyId;b.flight=1;b.ttl=1.35+Math.random()*.35;b.v.copy(base).add(new THREE.Vector3(s*.08,Math.sin(j*4)*.035,0)).normalize().multiplyScalar(9+Math.random()*2);});
    this.burst(center); return gate;
  }

  recall(){this.pendingVolleys.clear();for(const b of this.blades)if(b.flight>0){b.flight=2;b.ttl=0;}this.burst(this.center);}

  private burst(at:THREE.Vector3) {
    for(let i=0;i<36;i++){let j=-1;for(let k=0;k<this.sparkLife.length;k++)if(this.sparkLife[k]<=0){j=k;break;}if(j<0)break;this.sparkLife[j]=.6+Math.random()*.5;this.sparkPositions[j*3]=at.x;this.sparkPositions[j*3+1]=at.y;this.sparkPositions[j*3+2]=at.z;this.sparkVel[j].set((Math.random()-.5)*5,(Math.random()-.5)*5,(Math.random()-.5)*3);}
    const ring=this.rings.find(r=>!r.visible);if(ring){ring.visible=true;ring.position.copy(at);ring.scale.setScalar(.18);const idx=this.rings.indexOf(ring);this.ringLives[idx]=.8;}
  }

  private spatialCell(p:THREE.Vector3) {
    const x=clamp(Math.floor((p.x+GRID_X*GRID_CELL/2)/GRID_CELL),0,GRID_X-1);
    const y=clamp(Math.floor((p.y+GRID_Y*GRID_CELL/2)/GRID_CELL),0,GRID_Y-1);
    const z=clamp(Math.floor((p.z+GRID_Z*GRID_CELL/2)/GRID_CELL),0,GRID_Z-1);
    return x+GRID_X*(y+GRID_Y*z);
  }

  private updateSwarm(t:number,dt:number) {
    const center=this.baseCenter(dt); const n=this.bladeCount; const up=UP;
    this.neighborHeads.fill(-1);this.neighborNext.fill(-1,0,n);
    for(let i=0;i<n;i++){const b=this.blades[i];if(b.flight>0)continue;const cell=this.spatialCell(b.p);this.neighborNext[i]=this.neighborHeads[cell];this.neighborHeads[cell]=i;}
    for(let i=0;i<n;i++){
      const b=this.blades[i];
      if(b.flight===1){
        b.p.addScaledVector(b.v,dt);b.ttl-=dt;
        const hit=b.p.distanceToSquared(b.target)<.68*.68;
        if(hit||b.ttl<=0||b.p.z<-7.6){
          this.burst(hit?b.target:b.p);b.flight=2;b.ttl=0;
          const pending=this.pendingVolleys.get(b.volleyId);
          if(pending){if(hit)pending.hits++;pending.remaining--;if(pending.remaining<=0){this.pendingVolleys.delete(b.volleyId);this.onImpact(pending.hits>0);}}
        }
      }
      if(b.flight===2){
        this.dir.copy(this.center).sub(b.p);const distance=this.dir.length();
        if(distance<.38){b.flight=0;b.ttl=0;b.v.multiplyScalar(.08);}
        else{this.dir.multiplyScalar(Math.min(14,distance*2.8)/distance);b.v.lerp(this.dir,1-Math.exp(-dt*7.5));b.p.addScaledVector(b.v,dt);}
      }
      if(b.flight>0){this.dir.copy(b.v).normalize();this.alignment.setFromUnitVectors(up,this.dir);b.q.slerp(this.alignment,1-Math.exp(-dt*11));}
      else {
        this.formationPoint(i,n,t,b.target); b.target.add(center);
        const turbulence=this.charge*.14;
        b.target.x+=Math.sin(t*1.8+b.seed)*turbulence; b.target.y+=Math.cos(t*1.5+b.seed*1.3)*turbulence;
        let sx=0,sy=0,sz=0,vx=0,vy=0,vz=0,neighborCount=0;
        const gx=clamp(Math.floor((b.p.x+GRID_X*GRID_CELL/2)/GRID_CELL),0,GRID_X-1),gy=clamp(Math.floor((b.p.y+GRID_Y*GRID_CELL/2)/GRID_CELL),0,GRID_Y-1),gz=clamp(Math.floor((b.p.z+GRID_Z*GRID_CELL/2)/GRID_CELL),0,GRID_Z-1);
        for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const cx=gx+dx,cy=gy+dy,cz=gz+dz;if(cx<0||cx>=GRID_X||cy<0||cy>=GRID_Y||cz<0||cz>=GRID_Z)continue;
          const cell=cx+GRID_X*(cy+GRID_Y*cz);
          for(let j=this.neighborHeads[cell];j!==-1;j=this.neighborNext[j]){
            if(j===i)continue;const other=this.blades[j],ox=b.p.x-other.p.x,oy=b.p.y-other.p.y,oz=b.p.z-other.p.z,distSq=ox*ox+oy*oy+oz*oz;
            if(distSq<.46*.46&&distSq>1e-6){const dist=Math.sqrt(distSq),push=(.46-dist)/dist*1.7;sx+=ox*push;sy+=oy*push;sz+=oz*push;}
            if(distSq<1.22*1.22){vx+=other.v.x;vy+=other.v.y;vz+=other.v.z;neighborCount++;}
          }
        }
        this.separation.set(sx,sy,sz);
        if(neighborCount)this.alignmentForce.set(vx/neighborCount-b.v.x,vy/neighborCount-b.v.y,vz/neighborCount-b.v.z).multiplyScalar(.34);else this.alignmentForce.set(0,0,0);
        this.accel.copy(b.target).sub(b.p).multiplyScalar(11.5).addScaledVector(b.v,-4.6).add(this.separation).add(this.alignmentForce);
        const edgeX=3.8+this.camera.aspect*1.8;if(b.p.x>edgeX)this.accel.x-=(b.p.x-edgeX)*2.5;else if(b.p.x< -edgeX)this.accel.x-= (b.p.x+edgeX)*2.5;
        if(b.p.y>3.8)this.accel.y-=(b.p.y-3.8)*2.5;else if(b.p.y< -3.8)this.accel.y-= (b.p.y+3.8)*2.5;
        if(b.p.z>2.1)this.accel.z-=(b.p.z-2.1)*2.5;else if(b.p.z< -4.8)this.accel.z-= (b.p.z+4.8)*2.5;
        b.v.addScaledVector(this.accel,dt); b.p.addScaledVector(b.v,dt);
        this.radial.copy(b.p).sub(center); const radialLength=this.radial.length(); if(radialLength<.38){if(radialLength<.001)this.radial.set(1,0,0);else this.radial.multiplyScalar(1/radialLength);b.p.addScaledVector(this.radial,.38-radialLength);}
        if(this.formation==='spiral') this.facing.set(-b.target.y,b.target.x,.35).normalize();
        else if(this.formation==='shield') this.facing.set(Math.sin(i*2.4),.18,1).normalize();
        else if(this.formation==='spearhead') this.facing.set(0,1,.04).normalize();
        else this.facing.copy(b.target).normalize().add(this.offset.set(0,.18,.08)).normalize();
        if(this.hand&&Math.abs(this.hand.roll)>.25){this.rollAlignment.setFromAxisAngle(this.zAxis,this.hand.roll*.25);this.facing.applyQuaternion(this.rollAlignment);}
        this.alignment.setFromUnitVectors(up,this.facing); b.q.slerp(this.alignment,1-Math.exp(-dt*7.5));
      }
      const scale=b.scale*(b.flight>0?1.05:1);this.dummy.position.copy(b.p);this.dummy.quaternion.copy(b.q);this.dummy.scale.setScalar(scale);this.dummy.updateMatrix();this.bladeMesh.setMatrixAt(i,this.dummy.matrix);
      const k=i*6; const old=this.lastBladePositions[i]; this.trailPositions[k]=old.x;this.trailPositions[k+1]=old.y;this.trailPositions[k+2]=old.z;this.trailPositions[k+3]=b.p.x;this.trailPositions[k+4]=b.p.y;this.trailPositions[k+5]=b.p.z; old.copy(b.p);
    }
    this.bladeMesh.count=n;this.bladeMesh.instanceMatrix.needsUpdate=true;
    this.trails.geometry.setDrawRange(0,n*2);(this.trails.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;
    this.charge+=(this.handPose==='pinch'?1:-1)*dt*1.7;this.charge=clamp(this.charge,0,1);
    const targetCompact=(this.handPose==='fist'?1:0); this.compact+=(targetCompact-this.compact)*(1-Math.exp(-dt*8));
    this.gates.forEach((g,i)=>{g.group.rotation.z=t*(i%2?.12:-.08);const pulse=1+Math.sin(t*1.7+i*2.2)*.055+this.charge*.13;g.group.scale.setScalar(pulse);});
  }

  private updateEffects(dt:number,t:number) {
    for(let i=0;i<this.sparkLife.length;i++){if(this.sparkLife[i]<=0)continue;this.sparkLife[i]-=dt;this.sparkPositions[i*3]+=this.sparkVel[i].x*dt;this.sparkPositions[i*3+1]+=this.sparkVel[i].y*dt;this.sparkPositions[i*3+2]+=this.sparkVel[i].z*dt;this.sparkVel[i].multiplyScalar(Math.exp(-dt*2.3));if(this.sparkLife[i]<=0)this.sparkPositions[i*3+1]=-80;}
    (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;
    this.rings.forEach((ring,i)=>{if(this.ringLives[i]<=0)return;this.ringLives[i]-=dt;const scale=.18+(1-this.ringLives[i])*.95;ring.scale.setScalar(scale);(ring.material as THREE.MeshBasicMaterial).opacity=Math.max(0,this.ringLives[i]);if(this.ringLives[i]<=0)ring.visible=false;});
    this.floorShadow.position.x=this.center.x*.34;this.floorShadow.position.z=-3.8+this.center.z*.18;this.floorShadow.scale.setScalar(1+this.charge*.05);
    this.stars.rotation.y=Math.sin(t*.09)*.018;this.stars.rotation.x=Math.cos(t*.08)*.008;
    this.camera.position.x+=(this.center.x*.035-this.camera.position.x)*(1-Math.exp(-dt*1.8)); this.camera.position.y+=(this.center.y*.035-this.camera.position.y)*(1-Math.exp(-dt*1.8)); this.camera.lookAt(0,0,-.5);
    this.root.rotation.z=Math.sin(t*.12)*.006+(this.hand?.roll??0)*.018;
  }

  private tick = (now:number) => {
    this.raf=requestAnimationFrame(this.tick); if(!this.last)this.last=now;
    const dt=Math.min(.04,Math.max(.001,(now-this.last)/1000));this.last=now;const motionDt=this.reducedMotion?dt*.55:dt;this.elapsed+=this.paused?0:motionDt;
    if(!this.paused){
      if(this.flightMode==='swarm')this.updateSwarm(this.elapsed,motionDt);
      this.updateEffects(motionDt,this.elapsed);
      this.dragon.update(
        motionDt,
        this.elapsed,
        this.flightMode==='dragon'&&this.mode==='hand'?this.hand:null,
        this.flightMode==='dragon'&&this.mode==='mouse'?this.pointerTarget:null,
        this.dragonFireRequested,
      );
      this.dragonFireRequested=false;
    }
    this.renderer.render(this.scene,this.camera);
    this.fpsFrames++;if(!this.fpsStart)this.fpsStart=now;if(now-this.fpsStart>=450){this.fps=this.fpsFrames*1000/(now-this.fpsStart);this.fpsFrames=0;this.fpsStart=now;this.onFps(Math.round(this.fps));this.adaptQuality();}
  };
  dispose(){cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();window.removeEventListener('resize',this.resize);document.removeEventListener('visibilitychange',this.onVisibilityChange);this.dragon.dispose();this.renderer.dispose();}
}
