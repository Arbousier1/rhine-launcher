/**
 * Transmission adapted from Three.js 0.183.2 PhysicalLightingModel.js, with only
 * the archive LOD bound changed. Use public three/tsl and three/webgpu throughout:
 * mixing src nodes with the built TSL module creates incompatible singletons.
 *
 * The MIT License — Copyright © 2010-2026 three.js authors
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import { BackSide, FrontSide } from "three";
import { PhysicalLightingModel } from "three/webgpu";
import type { MeshPhysicalNodeMaterial, Node, NodeBuilder, TextureNode } from "three/webgpu";
import {
  DFGLUT, Fn, If, Loop, attenuationColor, attenuationDistance, cameraPosition,
  cameraProjectionMatrix, cameraViewMatrix, diffuseColor, dispersion, exp, float,
  int, ior, length, log, metalness, mix, modelWorldMatrix, normalWorld, normalize,
  positionWorld, refract, roughness, screenSize, specularColor, specularF90,
  textureBicubicLevel, thickness, transmission, vec2, vec3, vec4,
  viewportMipTexture, viewportOpaqueMipTexture,
} from "three/tsl";
import { archiveTransmissionLodNode } from "./surface-nodes.ts";

// @types/three 0.183.1 erases the texture type of these public factories.
const viewportBackSideTexture = viewportMipTexture() as TextureNode;
const viewportFrontSideTexture = viewportOpaqueMipTexture() as TextureNode;
// The runtime supports component-wise vec3 log/exp; r183 typings only expose float.
const vectorLog = log as unknown as (value: Node<"vec3">) => Node<"vec3">;
const vectorExp = exp as unknown as (value: Node<"vec3">) => Node<"vec3">;

export const archiveVolumeTransmissionRay = Fn(([n, v, depth, eta, model]: [Node<"vec3">, Node<"vec3">, Node<"float">, Node<"float">, Node<"mat4">]) => {
  const refractionVector = vec3(refract(v.negate(), normalize(n), float(1).div(eta)));
  const modelScale = vec3(length(vec4(model.element(int(0))).xyz), length(vec4(model.element(int(1))).xyz), length(vec4(model.element(int(2))).xyz));
  return normalize(refractionVector).mul(depth.mul(modelScale));
}).setLayout({
  name: "archiveVolumeTransmissionRay", type: "vec3", inputs: [
    { name: "n", type: "vec3" }, { name: "v", type: "vec3" },
    { name: "depth", type: "float" }, { name: "eta", type: "float" },
    { name: "model", type: "mat4" },
  ],
});

export const archiveVolumeAttenuation = Fn(([distance, tint, attenuationLength]: [Node<"float">, Node<"vec3">, Node<"float">]) => {
  // r183's materialAttenuationDistance maps Infinity to zero for WGSL.
  If(attenuationLength.notEqual(0), () => {
    const coefficient = vectorLog(tint).negate().div(attenuationLength);
    return vectorExp(coefficient.negate().mul(distance));
  });
  return vec3(1);
}).setLayout({
  name: "archiveVolumeAttenuation", type: "vec3", inputs: [
    { name: "distance", type: "float" }, { name: "tint", type: "vec3" },
    { name: "attenuationLength", type: "float" },
  ],
});

function transmissionSample(coordinates: Node<"vec2">, eta: Node<"float">, quality: Node<"float">, projectedAxis: Node<"vec2">, side: number) {
  const viewportTexture = side === BackSide ? viewportBackSideTexture : viewportFrontSideTexture;
  // roughness here is the final getRoughness result, including normal derivatives.
  const lod = archiveTransmissionLodNode(roughness, eta, screenSize, projectedAxis, quality);
  return textureBicubicLevel(viewportTexture.sample(coordinates), lod);
}

function refractionCoordinates(ray: Node<"vec3">) {
  const exit = positionWorld.add(ray);
  const ndc = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(exit, 1)));
  const coordinates = vec2(ndc.xy.div(ndc.w)).toVar();
  coordinates.addAssign(1);
  coordinates.divAssign(2);
  coordinates.assign(vec2(coordinates.x, coordinates.y.oneMinus()));
  return coordinates;
}

/** r183 volume refraction, including RGB dispersion, Fresnel and alpha/Beer attenuation. */
export function archiveIBLVolumeRefraction(quality: Node<"float">, projectedAxis: Node<"vec2">, side: number, useDispersion: boolean) {
  return Fn(() => {
    const n = normalWorld;
    const v = cameraPosition.sub(positionWorld).normalize();
    // These two r183 properties are not public TSL exports; use their exact definitions.
    const diffuseContribution = diffuseColor.rgb.mul(metalness.oneMinus());
    const blendedF0 = mix(specularColor, diffuseColor.rgb, metalness);
    let transmittedLight: Node<"vec4">;
    let transmittance: Node<"vec3">;

    if (useDispersion) {
      // Preserve r183 exactly: vec4() starts alpha at one, unlike vec4(0).
      // Its dispersion accumulator consequently includes that native alpha bias.
      transmittedLight = vec4().toVar();
      transmittance = vec3().toVar();
      const halfSpread = ior.sub(1).mul(dispersion.mul(0.025));
      const iors = vec3(ior.sub(halfSpread), ior, ior.add(halfSpread));
      Loop({ start: 0, end: 3 }, ({ i }) => {
        const eta = float(iors.element(i));
        const ray = archiveVolumeTransmissionRay(n, v, thickness, eta, modelWorldMatrix);
        const sample = transmissionSample(refractionCoordinates(ray), eta, quality, projectedAxis, side);
        transmittedLight.element(i).assign(sample.element(i));
        transmittedLight.a.addAssign(sample.a);
        transmittance.element(i).assign(float(diffuseContribution.element(i)).mul(
          float(archiveVolumeAttenuation(length(ray), attenuationColor, attenuationDistance).element(i)),
        ));
      });
      transmittedLight.a.divAssign(3);
    } else {
      const ray = archiveVolumeTransmissionRay(n, v, thickness, ior, modelWorldMatrix);
      transmittedLight = transmissionSample(refractionCoordinates(ray), ior, quality, projectedAxis, side);
      transmittance = diffuseContribution.mul(archiveVolumeAttenuation(length(ray), attenuationColor, attenuationDistance));
    }

    const attenuatedColor = transmittance.rgb.mul(transmittedLight.rgb);
    const dotNV = n.dot(v).clamp();
    // EnvironmentBRDF is private; its r183 implementation is precisely this DFG expression.
    const fab = vec2(DFGLUT({ roughness, dotNV }));
    const fresnel = vec3(blendedF0.mul(fab.x).add(specularF90.mul(fab.y)));
    const transmittanceFactor = transmittance.r.add(transmittance.g, transmittance.b).div(3);
    return vec4(fresnel.oneMinus().mul(attenuatedColor), transmittedLight.a.oneMinus().mul(transmittanceFactor).oneMinus());
  })();
}

export class ArchiveFrostedLightingModel extends PhysicalLightingModel {
  readonly archiveTransmission: boolean;
  readonly quality: Node<"float">;
  readonly projectedAxis: Node<"vec2">;
  readonly side: number;

  constructor(material?: MeshPhysicalNodeMaterial, quality: Node<"float"> = float(0), projectedAxis: Node<"vec2"> = vec2(0)) {
    // Disable ONLY the built-in transmission block. All other physical lobes stay native.
    super(material?.useClearcoat, material?.useSheen, material?.useIridescence,
      material?.useAnisotropy, false, material?.useDispersion);
    this.archiveTransmission = material?.useTransmission ?? false;
    this.quality = quality;
    this.projectedAxis = projectedAxis;
    this.side = material?.side ?? FrontSide;
  }

  override start(builder: NodeBuilder) {
    if (this.archiveTransmission) {
      const backdrop = archiveIBLVolumeRefraction(this.quality, this.projectedAxis, this.side, this.dispersion);
      // context is present in the pinned runtime but omitted from @types/three r183.
      const context = (builder as NodeBuilder & { context: { backdrop?: Node; backdropAlpha?: Node } }).context;
      context.backdrop = backdrop;
      context.backdropAlpha = transmission;
      diffuseColor.a.mulAssign(mix(1, backdrop.a, transmission));
    }
    super.start(builder);
  }
}
