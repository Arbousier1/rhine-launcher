import { DepthFormat, DepthTexture, HalfFloatType, LinearFilter, NearestFilter, NoBlending, NoColorSpace, NodeMaterial, QuadMesh, RenderTarget, UnsignedIntType } from 'three/webgpu';
import type { Node, Texture } from 'three/webgpu';

type Disposable = { dispose(): void };

/** Only resources created by this pipeline belong here; never scene materials or TSL singletons. */
export class PostResources {
  private readonly owned = new Set<Disposable>();
  private disposed = false;

  own<T extends Disposable>(value: T): T {
    if (this.disposed) { value.dispose(); throw new Error('Archive post pipeline is disposed'); }
    this.owned.add(value);
    return value;
  }

  target(name: string, options: { depth?: boolean; nearest?: boolean; count?: number; sampledDepth?: boolean } = {}): RenderTarget {
    const target = this.own(new RenderTarget(1, 1, {
      type: HalfFloatType,
      samples: 0,
      count: options.count ?? 1,
      depthBuffer: options.depth ?? false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
      minFilter: options.nearest ? NearestFilter : LinearFilter,
      magFilter: options.nearest ? NearestFilter : LinearFilter,
      generateMipmaps: false,
    }));
    target.textures.forEach((texture, index) => {
      texture.name = index === 0 ? name : name + '.' + index;
      this.own(texture);
    });
    if (options.sampledDepth) {
      const depth = this.own(new DepthTexture(1, 1));
      // AO reads only the depth aspect. r183 cannot sample an all-aspect
      // depth/stencil view; depth24plus preserves the used depth precision
      // without adding an unused stencil aspect to the sampled view.
      depth.format = DepthFormat;
      depth.type = UnsignedIntType;
      depth.minFilter = depth.magFilter = NearestFilter;
      depth.name = name + '.hardwareDepth';
      target.depthTexture = depth;
    }
    return target;
  }

  material(name: string, fragment: Node, geometry = false): NodeMaterial {
    const material = this.own(new NodeMaterial());
    material.name = name;
    material.fragmentNode = this.own(fragment);
    material.depthTest = material.depthWrite = geometry;
    material.blending = NoBlending;
    material.transparent = false;
    material.toneMapped = false;
    material.fog = false;
    // Renderer.renderObject must NOT inherit source alpha maps/transparency/positionNode.
    material.allowOverride = false;
    return material;
  }

  quad(): QuadMesh {
    const quad = new QuadMesh();
    // QuadMesh's default geometry is a library-wide singleton, not ours to dispose.
    quad.geometry = this.own(quad.geometry.clone());
    quad.name = 'ArchivePost.quad';
    return quad;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    for (const resource of Array.from(this.owned).reverse()) {
      try { resource.dispose(); } catch (error) { failure ??= error; }
    }
    this.owned.clear();
    if (failure !== undefined) throw failure;
  }
}

export function resizeTarget(target: RenderTarget, width: number, height: number): void {
  if (target.width !== width || target.height !== height) target.setSize(width, height);
}

/** Explicitly release attachments too, including targets never submitted to the renderer. */
export function disposeTargetTextures(target: RenderTarget): void {
  for (const texture of target.textures) texture.dispose();
  target.depthTexture?.dispose();
}

export function readyTextureImage(texture: Texture): boolean {
  const image = texture.image as HTMLImageElement | undefined;
  return !!image && image.complete && image.naturalWidth > 0;
}
