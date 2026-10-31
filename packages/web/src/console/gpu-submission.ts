/** Bounded GPU submission, not a quality/FPS preset. Never waits synchronously. */
export class GpuSubmissionGate{
 private fence:WebGLSync|null=null
 private supported:boolean
 submittedFrames=0;deferredFrames=0
 constructor(private gl:WebGL2RenderingContext){this.supported=typeof gl.fenceSync==='function'&&typeof gl.clientWaitSync==='function'}
 ready():boolean{
  if(!this.supported)return true
  if(this.gl.isContextLost()){this.reset();this.deferredFrames++;return false}
  if(!this.fence)return true
  const status=this.gl.clientWaitSync(this.fence,0,0)
  if(status===this.gl.TIMEOUT_EXPIRED){this.deferredFrames++;return false}
  this.gl.deleteSync(this.fence);this.fence=null
  return true
 }
 submitted(){this.submittedFrames++;if(!this.supported)return;this.fence=this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE,0);this.gl.flush()}
 reset(){if(this.fence){this.gl.deleteSync(this.fence);this.fence=null}}
 dispose(){this.reset()}
}
