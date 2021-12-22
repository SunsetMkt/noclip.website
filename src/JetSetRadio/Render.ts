
import * as Ninja from "./Ninja";
import { GfxDevice, GfxBuffer, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxCompareMode, GfxProgram, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxInputLayoutBufferDescriptor, GfxVertexBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { DeviceProgram } from "../Program";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { mat4, ReadonlyMat4, ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import { fillMatrix4x3, fillMatrix4x2, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { computeModelMatrixR, lerpAngle } from "../MathHelpers";
import { PVR_Texture } from "./PVRT";
import { PVRTextureHolder } from "./Scenes";

export class JSRProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;
    public static a_Diffuse = 3;
    public static a_Specular = 4;
    public static a_Extra = 5;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public both = `
precision mediump float;
// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x3 u_LightDirection;
};
layout(row_major, std140) uniform ub_ModelParams {
    Mat4x3 u_BoneMatrix;
    Mat4x2 u_TextureMatrix;
    vec4   u_Diffuse;
    vec4   u_Ambient;
    vec4   u_Specular;
};
#ifdef NORMAL
varying vec3 v_Normal;
#endif
#ifdef DIFFUSE
varying vec4 v_Diffuse;
#endif
#ifdef SPECULAR
varying vec4 v_Specular;
#endif
#ifdef TEXTURE
varying vec2 v_TexCoord;
uniform sampler2D u_Texture;
#endif
`;

    public vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_Diffuse;
layout(location = 4) in vec4 a_Specular;
void main() {
    gl_Position = vec4(a_Position, 1.0);
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix), gl_Position));
#ifdef NORMAL
    v_Normal = normalize(Mul(_Mat4x4(u_BoneMatrix), vec4(a_Normal, 0.0)).xyz);
#endif
#ifdef DIFFUSE
    v_Diffuse = a_Diffuse;
#endif
#ifdef SPECULAR
    v_Specular = a_Specular;
#endif
#ifdef TEXTURE
    v_TexCoord = a_TexCoord;
    v_TexCoord = Mul(_Mat4x4(u_TextureMatrix), vec4(v_TexCoord, 0.0, 1.0)).xy;
#endif
}
`;

public frag = `
void main() {
    vec4 t_Color = clamp(u_Diffuse /*+ u_Ambient + u_Specular*/, 0.0, 1.0);
#ifdef TEXTURE
    t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
#endif
    gl_FragColor = t_Color;
}
`;

    constructor() {
        super();
    }
}

export class NjsMeshData {
    private vertexBuffers: GfxBuffer[] = [];
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    public indexCount: number;

    constructor (device: GfxDevice, cache: GfxRenderCache, public mesh: Ninja.NJS_MESH) {
        //const positions: vec3[] = [[-10000,-100,-10000], [-10000,-100,+10000], [+10000,-100,-10000], [+10000,-100,+10000]];
        const vertices: Ninja.NJS_VERTS = this.mesh.vertices; //{positions, normals: [], uvs: [], diffuse: [], specular: []};
        const indices: number[] = this.mesh.indices; //[0, 1, 2, 2, 1, 3];

        let vertexOffset = 0;
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        const inputLayoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];
        const vertexBufferDescriptors: GfxVertexBufferDescriptor[] = []

        if (vertices.positions.length > 0) {
            const values = vertices.positions.reduce((accumulator, currentValue) => accumulator.concat(...currentValue), [] as number[]);
            const buffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, Float32Array.from(values).buffer);
            const bufferIndex = this.vertexBuffers.length;

            this.vertexBuffers.push(buffer);
            vertexAttributeDescriptors.push({ location: JSRProgram.a_Position, bufferIndex, bufferByteOffset: 0, format: GfxFormat.F32_RGB });
            inputLayoutBufferDescriptors.push({ byteStride: 0x0C, frequency: GfxVertexBufferFrequency.PerVertex, });
            vertexBufferDescriptors.push({ buffer, byteOffset: 0, });

            vertexOffset += 0x0C;
        }
        if (vertices.normals.length > 0) {
            const values = vertices.normals.reduce((accumulator, currentValue) => accumulator.concat(...currentValue), [] as number[]);
            const buffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, Float32Array.from(values).buffer);
            const bufferIndex = this.vertexBuffers.length;

            this.vertexBuffers.push(buffer);
            vertexAttributeDescriptors.push({ location: JSRProgram.a_Normal, bufferIndex, bufferByteOffset: 0, format: GfxFormat.F32_RGB });
            inputLayoutBufferDescriptors.push({ byteStride: 0x0C, frequency: GfxVertexBufferFrequency.PerVertex, });
            vertexBufferDescriptors.push({ buffer, byteOffset: 0, });

            vertexOffset += 0x0C;
        }
        if (vertices.uvs.length > 0) {
            const values = vertices.uvs.reduce((accumulator, currentValue) => accumulator.concat(...currentValue), [] as number[]);
            const buffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, Float32Array.from(values).buffer);
            const bufferIndex = this.vertexBuffers.length;

            this.vertexBuffers.push(buffer);
            vertexAttributeDescriptors.push({ location: JSRProgram.a_TexCoord, bufferIndex, bufferByteOffset: 0, format: GfxFormat.F32_RG });
            inputLayoutBufferDescriptors.push({ byteStride: 0x08, frequency: GfxVertexBufferFrequency.PerVertex, });
            vertexBufferDescriptors.push({ buffer, byteOffset: 0, });

            vertexOffset += 0x08;
        }
        if (vertices.diffuse.length > 0) {
            const values = vertices.diffuse.reduce((accumulator, currentValue) => accumulator.concat(currentValue.r, currentValue.g, currentValue.b, currentValue.a), [] as number[]);
            const buffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, Float32Array.from(values).buffer);
            const bufferIndex = this.vertexBuffers.length;

            this.vertexBuffers.push(buffer);
            vertexAttributeDescriptors.push({ location: JSRProgram.a_Diffuse, bufferIndex, bufferByteOffset: 0, format: GfxFormat.F32_RGBA });
            inputLayoutBufferDescriptors.push({ byteStride: 0x10, frequency: GfxVertexBufferFrequency.PerVertex, });
            vertexBufferDescriptors.push({ buffer, byteOffset: 0, });

            vertexOffset += 0x10;
        }
        if (vertices.specular.length > 0) {
            const values = vertices.specular.reduce((accumulator, currentValue) => accumulator.concat(currentValue.r, currentValue.g, currentValue.b, currentValue.a), [] as number[]);
            const buffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, Float32Array.from(values).buffer);
            const bufferIndex = this.vertexBuffers.length;

            this.vertexBuffers.push(buffer);
            vertexAttributeDescriptors.push({ location: JSRProgram.a_Specular, bufferIndex, bufferByteOffset: 0, format: GfxFormat.F32_RGBA });
            inputLayoutBufferDescriptors.push({ byteStride: 0x10, frequency: GfxVertexBufferFrequency.PerVertex, });
            vertexBufferDescriptors.push({ buffer, byteOffset: 0, });

            vertexOffset += 0x10;
        }

        const indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, Uint16Array.from(indices).buffer);
        const indexBufferFormat = GfxFormat.U16_R;
        const indexBufferDescriptor = { buffer: indexBuffer, byteOffset: 0, };

        this.indexCount = indices.length;

        this.inputLayout = cache.createInputLayout( { vertexAttributeDescriptors, vertexBufferDescriptors: inputLayoutBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, vertexBufferDescriptors, indexBufferDescriptor);
    }

    public destroy(device: GfxDevice): void {
        for (let vertexBuffer of this.vertexBuffers) {
            device.destroyBuffer(vertexBuffer);
        }
        if (this.indexBuffer) device.destroyBuffer(this.indexBuffer);
        if (this.inputLayout) device.destroyInputState(this.inputState);
    }
}

export class NjsModelData {
    public meshes: NjsMeshData[] = [];

    constructor (device: GfxDevice, cache: GfxRenderCache, public model: Ninja.NJS_MODEL) {
        for (let i = 0; i < this.model.meshes.length; ++i) {
            this.meshes.push(new NjsMeshData(device, cache, this.model.meshes[i]));
        }
    }

    public destroy(device: GfxDevice): void {
        for (let mesh of this.meshes) {
            mesh.destroy(device);
        }
    }
}

export class NjsObjectData {
    public model?: NjsModelData;

    constructor (device: GfxDevice, cache: GfxRenderCache, public object: Ninja.NJS_OBJECT) {
        if (this.object.model) {
            this.model = new NjsModelData(device, cache, this.object.model);
        }
    }

    public destroy(device: GfxDevice): void {
        this.model?.destroy(device);
    }
}

export class NjsActionData {
    public objects: NjsObjectData[] = [];
    public motions: Ninja.NJS_MOTION[] = [];
    public texlist: number[] | null;

    constructor (device: GfxDevice, cache: GfxRenderCache, public action: Ninja.NJS_ACTION, public wrapMode: number = 0) {
        for (let i = 0; i < this.action.objects.length; ++i) {
            this.objects.push(new NjsObjectData(device, cache, this.action.objects[i]));
        }

        this.motions = this.action.motions;
    }

    public destroy(device: GfxDevice): void {
        for (let object of this.objects) {
            object.destroy(device);
        }
    }
}

function translateBlendFactor(blendAlpha: Ninja.NJS_BLENDALPHA, isSource: boolean): GfxBlendFactor {
    switch (blendAlpha) {
        case Ninja.NJS_BLENDALPHA.ZERO:
            return GfxBlendFactor.Zero;
        case Ninja.NJS_BLENDALPHA.ONE:
            return GfxBlendFactor.One;
        case Ninja.NJS_BLENDALPHA.OTHER_COLOR:
            return isSource ? GfxBlendFactor.Dst : GfxBlendFactor.Src;
        case Ninja.NJS_BLENDALPHA.ONE_MINUS_OTHER_COLOR:
            return isSource ? GfxBlendFactor.OneMinusDst : GfxBlendFactor.OneMinusSrc;
        case Ninja.NJS_BLENDALPHA.SRC_ALPHA:
            return GfxBlendFactor.SrcAlpha;
        case Ninja.NJS_BLENDALPHA.ONE_MINUS_SRC_ALPHA:
            return GfxBlendFactor.OneMinusSrcAlpha;
        case Ninja.NJS_BLENDALPHA.DST_ALPHA:
            return GfxBlendFactor.DstAlpha;
        case Ninja.NJS_BLENDALPHA.ONE_MINUS_DST_ALPHA:
            return GfxBlendFactor.OneMinusDstAlpha;
        default:
            return isSource ? GfxBlendFactor.One : GfxBlendFactor.Zero;
    }
}

export class NjsMeshInstance {
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private textureMappings: TextureMapping[] = [];
    private textureMatrix = mat4.create();
    public layer = GfxRendererLayer.OPAQUE;
    public depthSort = false;

    constructor(cache: GfxRenderCache, public data: NjsMeshData, texlist: number[], textureHolder: PVRTextureHolder) {
        const program = new JSRProgram();

        const doubleSided = (this.data.mesh.flags & Ninja.NJS_ATTRIBUTE_FLAGS.DOUBLE_SIDED) != 0;

        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: true,
            cullMode: doubleSided ? GfxCullMode.None : GfxCullMode.None,
        };

        const useAlpha = (this.data.mesh.flags & Ninja.NJS_ATTRIBUTE_FLAGS.USE_ALPHA) != 0;
        const srcAlpha = useAlpha ? this.data.mesh.material.srcAlpha : -1;
        const dstAlpha = useAlpha ? this.data.mesh.material.dstAlpha : -1;

        if (useAlpha) {
            this.layer = GfxRendererLayer.ALPHA_TEST | GfxRendererLayer.TRANSLUCENT;
        }

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: translateBlendFactor(srcAlpha, true),
            blendDstFactor: translateBlendFactor(dstAlpha, false),
        });

        const material = this.data.mesh.material;
        const texture = material.texture;
        if (texture) {
            const textureId = texlist[texture.texture];
            const textureName = textureHolder.getTextureName(textureId);
            if (textureName !== null) {
                const textureMapping = new TextureMapping();
                const enabled = textureHolder.fillTextureMapping(textureMapping, textureName);

                if (enabled) {
                    const filterMode = texture.filterMode;
                    const [magFilter] = translateTextureFilter(filterMode);
                    const [minFilter, mipFilter] = translateTextureFilter(filterMode);

                    const wrapS = texture.clampU ? GfxWrapMode.Clamp : GfxWrapMode.Mirror;
                    const wrapT = texture.clampV ? GfxWrapMode.Clamp : GfxWrapMode.Mirror;

                    textureMapping.gfxSampler = cache.createSampler({
                        minFilter, magFilter, mipFilter,
                        wrapS, wrapT,
                        minLOD: 0, maxLOD: 100,
                    });

                    program.setDefineBool('TEXTURE', true);
                    this.textureMappings.push(textureMapping);
                }
            }
        }

        this.gfxProgram = cache.createProgram(program);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, modelViewMatrix: mat4): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.data.inputLayout, this.data.inputState);
        template.sortKey = makeSortKey(this.layer);
        /*if (this.depthSort) {
            transformVec3Mat4w1(posScrath, scratchMatrix, this.model.center);
            template.sortKey = setSortKeyDepth(template.sortKey, -posScrath[2]);
        }*/

        //
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        renderInst.drawIndexes(this.data.indexCount, 0);

        if (this.textureMappings.length > 0) {
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        }

        let offs = renderInst.allocateUniformBuffer(JSRProgram.ub_ModelParams, 12 + 8 + 4 + 4 + 4);
        const mapped = renderInst.mapUniformBufferF32(JSRProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, modelViewMatrix);
        offs += fillMatrix4x2(mapped, offs, this.textureMatrix);
        offs += fillColor(mapped, offs, this.data.mesh.material.diffuse);
        offs += fillColor(mapped, offs, this.data.mesh.material.ambient);
        offs += fillColor(mapped, offs, this.data.mesh.material.specular);
        renderInstManager.submitRenderInst(renderInst);

        //
        renderInstManager.popTemplateRenderInst();
    }
}

export class NjsModelInstance {
    public meshes: NjsMeshInstance[] = [];
    public visible = true;

    constructor(cache: GfxRenderCache, public data: NjsModelData, texlist: number[], textureHolder: PVRTextureHolder) {
        for (let i = 0; i < this.data.meshes.length; i++)
            this.meshes.push(new NjsMeshInstance(cache, this.data.meshes[i], texlist, textureHolder));
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, parentMatrix: mat4): void {
        if (!this.visible)
            return;

        const bounds: vec4 = this.data.model.bounds;
        const center: vec3 = vec3.fromValues(bounds[0], bounds[1], bounds[2]);
        const radius: number = bounds[3];
        vec3.transformMat4(center, center, parentMatrix);
        if (!viewerInput.camera.frustum.containsSphere(center, radius))
            return;

        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, parentMatrix);

        for (let i = 0; i < this.meshes.length; i++)
            this.meshes[i].prepareToRender(renderInstManager, scratchMatrix);
    }
}

export class NjsObjectInstance {
    public position = vec3.create();
    public rotation = vec3.create();
    public scale = vec3.fromValues(1, 1, 1);
    public modelMatrix = mat4.create();
    public model: NjsModelInstance;

    constructor(cache: GfxRenderCache, public data: NjsObjectData, texlist: number[], textureHolder: PVRTextureHolder) {
        const usePosition = (this.data.object.flags & Ninja.NJS_EVALFLAGS.EVAL_UNIT_POS) == 0;
        this.position = usePosition ? this.data.object.position : vec3.create();
        const useRotation = (this.data.object.flags & Ninja.NJS_EVALFLAGS.EVAL_UNIT_ROT) == 0;
        this.rotation = useRotation ? this.data.object.rotation : vec3.create();
        const useScale = (this.data.object.flags & Ninja.NJS_EVALFLAGS.EVAL_UNIT_SCL) == 0;
        this.scale = useScale ? this.data.object.scale : vec3.fromValues(1, 1, 1);

        this.update(mat4.create());

        if (this.data.model) {
            this.model = new NjsModelInstance(cache, this.data.model, texlist, textureHolder);
        }
    }

    public update(modelMatrix: ReadonlyMat4): void {
        const evalZXY = !!(this.data.object.flags & Ninja.NJS_EVALFLAGS.EVAL_ZXY_ANG);
        const skip = (this.data.object.flags & 0x07) === 0x07;

        if (evalZXY) {
            computeMatrix(this.modelMatrix, modelMatrix, this.scale, this.rotation, this.position, OperationOrder.SRT, EulerOrder.ZXY);
        } else {
            computeMatrix(this.modelMatrix, modelMatrix, this.scale, this.rotation, this.position, OperationOrder.SRT, EulerOrder.XYZ);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.model) {
            this.model.prepareToRender(renderInstManager, viewerInput, this.modelMatrix);
        }
    }
}

export class NjsMotionInstance {
    constructor (cache: GfxRenderCache, public object: NjsObjectInstance, public data: Ninja.NJS_MOTION) {
    }

    public update(frame: number) {
        const duration = this.data.frames;
        let keyA = Math.floor(frame);
        let keyB = Math.ceil(frame);
        const alpha = frame - keyA;

        if (keyB >= duration) {
            keyB = 0;
        }

        if (this.data.positions.length > 0) {
            const position: vec3 = vec3.create();
            vec3.lerp(position, this.data.positions[keyA], this.data.positions[keyB], alpha);
            this.object.position = position;
        } else {
            const usePosition = (this.object.data.object.flags & Ninja.NJS_EVALFLAGS.EVAL_UNIT_POS) == 0;
            this.object.position = usePosition ? this.object.data.object.position : vec3.create();
        }

        if (this.data.rotations.length > 0) {
            const rotationA = this.data.rotations[keyA];
            const rotationB = this.data.rotations[keyB];
            const rotation: vec3 = vec3.create();
            //vec3.lerp(rotation, rotationA, rotationB, alpha);
            rotation[0] = lerpAngle(rotationA[0], rotationB[0], alpha);
            rotation[1] = lerpAngle(rotationA[1], rotationB[1], alpha);
            rotation[2] = lerpAngle(rotationA[2], rotationB[2], alpha);

            const useRotation = (this.data.flags & 0x10) != 0;
            this.object.rotation = rotation;
        } else {
            const useRotation = (this.object.data.object.flags & Ninja.NJS_EVALFLAGS.EVAL_UNIT_ROT) == 0;
            this.object.rotation = useRotation ? this.object.data.object.rotation : vec3.create();
        }

        if (this.data.scales.length > 0) {
            const scale: vec3 = vec3.create();
            vec3.lerp(scale, this.data.scales[keyA], this.data.scales[keyB], alpha);
            this.object.scale = scale;
        } else {
            const useScale = (this.object.data.object.flags & Ninja.NJS_EVALFLAGS.EVAL_UNIT_SCL) == 0;
            this.object.scale = useScale ? this.object.data.object.scale : vec3.fromValues(1, 1, 1);
        }
    }
}

export class NjsActionInstance {
    public objects: NjsObjectInstance[] = [];
    public motions: NjsMotionInstance[] = [];

    public frame: number = -1;

    constructor (cache: GfxRenderCache, public data: NjsActionData, texlist: number[], textureHolder: PVRTextureHolder) {
        for (let i = 0; i < this.data.objects.length; ++i)
            this.objects.push(new NjsObjectInstance(cache, this.data.objects[i], texlist, textureHolder));

        for (let i = 0; i < this.data.motions.length; ++i)
            this.motions.push(new NjsMotionInstance(cache, this.objects[i], this.data.motions[i]));
    }

    public update(modelMatrix: mat4, frameDelta: number) {
        if (this.frame < 0) {
            this.frame = 0;
        } else {
            this.frame += frameDelta;
        }
        const duration = this.data.action.frames;
        switch (this.data.wrapMode) {
            case 0:
                {
                    if (this.frame < 0) {
                        this.frame += duration;
                    } else if (this.frame >= duration) {
                        this.frame -= duration;
                    }
                    if (this.frame < 0) {
                        this.frame = duration - 1;
                    } else if (this.frame > duration - 1) {
                        this.frame = 0;
                    }
                    break;
                }
            case 1:
                {
                    if (this.frame < 0) {
                        //this.frame = 0;
                        this.frame = duration - 1;
                    } else if (this.frame > duration - 1) {
                        //this.frame = duration - 1;
                        this.frame = 0;
                    }
                    break;
                }
            default:
                {
                    // Should not happen.
                    this.frame = 0;
                    break;
                }
        }
        for (let i = 0; i < this.data.motions.length; ++i) {
            this.motions[i].update(this.frame);
        }

        for (let i = 0; i < this.data.objects.length; ++i) {
            const parent = this.objects[i].data.object.parent;
            const parentTransform = parent < 0 ? modelMatrix : this.objects[parent].modelMatrix;

            this.objects[i].update(parentTransform);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.data.objects.length; ++i) {
            this.objects[i].prepareToRender(renderInstManager, viewerInput);
        }
    }
}

function translateTextureFilter(filter: Ninja.FILTER_MODE): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (filter) {
        case Ninja.FILTER_MODE.POINT:
            return [GfxTexFilterMode.Point, GfxMipFilterMode.NoMip];
        case Ninja.FILTER_MODE.BILINEAR:
            return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.NoMip];
        case Ninja.FILTER_MODE.TRILINEAR:
            return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.Linear];
        default: throw new Error();
    }
}

const toNoclip = mat4.create();
mat4.fromXRotation(toNoclip, Math.PI);

const scratchMatrix = mat4.create();

const enum OperationOrder {
    SRT,
    RST,
    TSR,
    STR,
    RTS,
    TRS,
}

const computeMatrixMap = [
    (out: mat4, a: ReadonlyMat4, s: ReadonlyVec3, r: ReadonlyVec3, t: ReadonlyVec3, order: EulerOrder): mat4 => { mat4.translate(out, a, t); rotateMatrixMap[order](out, out, r); mat4.scale(out, out, s); return out; }, // SRT
    (out: mat4, a: ReadonlyMat4, s: ReadonlyVec3, r: ReadonlyVec3, t: ReadonlyVec3, order: EulerOrder): mat4 => { mat4.translate(out, a, t); mat4.scale(out, out, s); rotateMatrixMap[order](out, out, r); return out; }, // RST
    (out: mat4, a: ReadonlyMat4, s: ReadonlyVec3, r: ReadonlyVec3, t: ReadonlyVec3, order: EulerOrder): mat4 => { rotateMatrixMap[order](out, a, r); mat4.scale(out, out, s); mat4.translate(out, out, t); return out; }, // TSR
    (out: mat4, a: ReadonlyMat4, s: ReadonlyVec3, r: ReadonlyVec3, t: ReadonlyVec3, order: EulerOrder): mat4 => { rotateMatrixMap[order](out, a, r); mat4.translate(out, out, t); mat4.scale(out, out, s); return out; }, // STR
    (out: mat4, a: ReadonlyMat4, s: ReadonlyVec3, r: ReadonlyVec3, t: ReadonlyVec3, order: EulerOrder): mat4 => { mat4.scale(out, a, s); mat4.translate(out, out, t); rotateMatrixMap[order](out, out, r); return out; }, // RTS
    (out: mat4, a: ReadonlyMat4, s: ReadonlyVec3, r: ReadonlyVec3, t: ReadonlyVec3, order: EulerOrder): mat4 => { mat4.scale(out, a, s); rotateMatrixMap[order](out, out, r); mat4.translate(out, out, t); return out; }, // TRS
]

function computeMatrix(out: mat4, a: ReadonlyMat4, s: ReadonlyVec3, r: ReadonlyVec3, t: ReadonlyVec3, operationorder: OperationOrder, eulerOrder: EulerOrder): mat4 {
    return computeMatrixMap[operationorder](out, a, s, r, t, eulerOrder);
}

const enum EulerOrder {
    XYZ,
    YXZ,
    ZXY,
    XZY,
    YZX,
    ZYX,
}

const computeRotationOrderMap = [
    [mat4.rotateX, mat4.rotateY, mat4.rotateZ], // XYZ
    [mat4.rotateY, mat4.rotateX, mat4.rotateZ], // YXZ
    [mat4.rotateZ, mat4.rotateX, mat4.rotateY], // ZXY
    [mat4.rotateX, mat4.rotateZ, mat4.rotateY], // XZY
    [mat4.rotateY, mat4.rotateZ, mat4.rotateX], // YZX
    [mat4.rotateZ, mat4.rotateY, mat4.rotateX], // ZYX
]

const enum Component {
    X,
    Y,
    Z,
}

const componentOrderMap = [
    [Component.X, Component.Y, Component.Z], // XYZ
    [Component.Y, Component.X, Component.Z], // YXZ
    [Component.Z, Component.X, Component.Y], // ZXY
    [Component.X, Component.Z, Component.Y], // XZY
    [Component.Y, Component.Z, Component.X], // YZX
    [Component.Z, Component.Y, Component.X], // ZYX
]

const rotateMatrixMap = [
    (out: mat4, a: ReadonlyMat4, v: ReadonlyVec3) => rotateMatrix(out, a, v, EulerOrder.XYZ), // XYZ
    (out: mat4, a: ReadonlyMat4, v: ReadonlyVec3) => rotateMatrix(out, a, v, EulerOrder.YXZ), // YXZ
    (out: mat4, a: ReadonlyMat4, v: ReadonlyVec3) => rotateMatrix(out, a, v, EulerOrder.ZXY), // ZXY
    (out: mat4, a: ReadonlyMat4, v: ReadonlyVec3) => rotateMatrix(out, a, v, EulerOrder.XZY), // XZY
    (out: mat4, a: ReadonlyMat4, v: ReadonlyVec3) => rotateMatrix(out, a, v, EulerOrder.YZX), // YZX
    (out: mat4, a: ReadonlyMat4, v: ReadonlyVec3) => rotateMatrix(out, a, v, EulerOrder.ZYX), // ZYX
]

function rotateMatrix(out: mat4, a: ReadonlyMat4, v: ReadonlyVec3, order: EulerOrder): mat4 {
    const matrixOrder = computeRotationOrderMap[order];
    const componentOrder = componentOrderMap[order];
    matrixOrder[2](out,   a, v[componentOrder[2]]);
    matrixOrder[1](out, out, v[componentOrder[1]]);
    matrixOrder[0](out, out, v[componentOrder[0]]);

    return out;
}