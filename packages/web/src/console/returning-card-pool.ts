import * as THREE from 'three'
import type {CardAppearance} from './appearance'
interface Copy{group:THREE.Group;canvas:HTMLCanvasElement;texture:THREE.CanvasTexture;free:boolean}
/** Reuse released copies only. Active copies retain their own label, uniforms and motion state. */
export class ReturningCardPool{
 private copies=new Map<THREE.Group,Copy>();private available:Copy[]=[]
 constructor(private appearance:Pick<CardAppearance,'prepare'|'dispose'>,private limit=6){}
 acquire(model:THREE.Group,label:HTMLCanvasElement):THREE.Group{
  let copy=this.available.pop()
  if(!copy){const group=model.clone(true),canvas=document.createElement('canvas');canvas.width=label.width;canvas.height=label.height;const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const mesh=group.children[group.children.length-1] as THREE.Mesh;mesh.material=new THREE.MeshBasicMaterial({map:texture,toneMapped:false,transparent:true,depthWrite:false});this.appearance.prepare(group);copy={group,canvas,texture,free:false};this.copies.set(group,copy)}
  copy.free=false;copy.group.position.copy(model.position);copy.group.quaternion.copy(model.quaternion);copy.group.scale.copy(model.scale);copy.group.visible=model.visible;copy.group.renderOrder=model.renderOrder;copy.group.updateMatrix()
  const context=copy.canvas.getContext('2d')!;context.clearRect(0,0,copy.canvas.width,copy.canvas.height);context.drawImage(label,0,0);copy.texture.anisotropy=1;copy.texture.needsUpdate=true
  return copy.group
 }
 release(group:THREE.Group){const copy=this.copies.get(group);if(!copy||copy.free)return;group.removeFromParent();if(this.available.length>=this.limit){this.appearance.dispose(group);this.copies.delete(group);return}copy.free=true;this.available.push(copy)}
 dispose(){for(const copy of this.copies.values()){copy.group.removeFromParent();this.appearance.dispose(copy.group)}this.available=[];this.copies.clear()}
 get stats(){return {active:this.copies.size-this.available.length,retained:this.available.length,total:this.copies.size}}
}
