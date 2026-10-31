import {SCAN_FROM,SCAN_TO,SCAN_CORNERS,type DecryptionFrame} from './decryption'
export function inspectionSegments(frame:DecryptionFrame){const point=(t:number):[number,number]=>[SCAN_FROM[0]+(SCAN_TO[0]-SCAN_FROM[0])*t,SCAN_FROM[1]+(SCAN_TO[1]-SCAN_FROM[1])*t];return frame.intervals.map(([a,b])=>[point(a),point(b)] as const)}
function attribute(node:Element,key:string,value:string){if(node.getAttribute(key)!==value)node.setAttribute(key,value)}
function opacity(node:HTMLElement|SVGElement,value:string){if(node.style.opacity!==value)node.style.opacity=value}
/** Keep the original geometry, but never build invisible SVG geometry every frame. */
export class InspectionOverlay{
 private root=document.querySelector<SVGSVGElement>('#inspection-marks')!
 private host=document.querySelector<HTMLElement>('#three-scene')!
 private line=this.root.querySelector<SVGPathElement>('#inspection-lines')!
 private corners=this.root.querySelector<SVGGElement>('#inspection-corners')!
 private point=this.root.querySelector<SVGCircleElement>('#inspection-point')!
 private label=document.querySelector<HTMLElement>('#inspection-text')!
 private value=this.label.querySelector<HTMLElement>('strong')!
 private rects=SCAN_CORNERS.map(()=>{const node=document.createElementNS('http://www.w3.org/2000/svg','rect');node.setAttribute('width','8');node.setAttribute('height','8');return node})
 private sizeDirty=true
 private resizeObserver=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(()=>{this.sizeDirty=true})
 constructor(){this.corners.replaceChildren(...this.rects);this.resizeObserver?.observe(this.host)}
 dispose(){this.resizeObserver?.disconnect()}
 render(frame:DecryptionFrame,project:(x:number,y:number)=>number[],showLabel:boolean,enabled=true){
  const visible=enabled&&Boolean(frame.intervals.length||frame.markers>0||frame.point>0)
  if(visible&&(this.sizeDirty||!this.resizeObserver)){attribute(this.root,'viewBox','0 0 '+this.host.clientWidth+' '+this.host.clientHeight);this.sizeDirty=false}
  opacity(this.root,visible?'1':'0');attribute(this.root,'data-phase',frame.phase);attribute(this.root,'data-reference-time',frame.time.toFixed(3))
  opacity(this.label,String(enabled&&showLabel?frame.label:0));opacity(this.value,String(frame.labelValue))
  if(!visible)return
  attribute(this.line,'d',inspectionSegments(frame).map(([a,b])=>'M'+project(...a)+'L'+project(...b)).join(''))
  opacity(this.corners,String(frame.markers))
  if(frame.markers>0)SCAN_CORNERS.forEach(([x,y],index)=>{const [px,py]=project(x,y);attribute(this.rects[index],'x',String(px-4));attribute(this.rects[index],'y',String(py-4))})
  opacity(this.point,String(frame.point))
  if(frame.point>0){const [x,y]=project((SCAN_FROM[0]+SCAN_TO[0])/2,(SCAN_FROM[1]+SCAN_TO[1])/2);attribute(this.point,'cx',String(x));attribute(this.point,'cy',String(y))}
 }
}
