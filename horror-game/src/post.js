// 後製：泛光 + 恐怖濾鏡（色調映射、底片顆粒、暗角、色差、理智扭曲、雜訊、受傷紅光、調色）
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.75 },
    uAberr: { value: 0.3 },
    uDistort: { value: 0 },
    uStatic: { value: 0 },
    uRed: { value: 0 },
    uDesat: { value: 0.15 },
    uFade: { value: 0 },
    uFlash: { value: 0 },
    uPulse: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberr, uDistort, uStatic, uRed, uDesat, uFade, uFlash, uPulse;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 uv = vUv;
      // 理智扭曲：緩慢的波動
      uv += uDistort * vec2(sin(uv.y * 18.0 + uTime * 1.7), cos(uv.x * 14.0 + uTime * 1.3)) * 0.0045;
      // 雜訊撕裂（類比錄影機）
      float band = step(1.0 - uStatic * 0.08, hash(vec2(floor(uv.y * 90.0), floor(uTime * 24.0))));
      uv.x += band * (hash(vec2(uTime, uv.y)) - 0.5) * 0.06 * uStatic;
      vec2 dir = uv - 0.5;
      float d = length(dir);
      float ab = uAberr * (0.0015 + d * d * 0.02);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;
      // 色調映射與 sRGB 轉換直接在這裡做（省掉一道 OutputPass 全螢幕繪製）
      #ifdef TONE_MAPPING
        col = toneMapping(col);
      #endif
      col = linearToOutputTexel(vec4(col, 1.0)).rgb;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      // 冷色暗部、偏黃亮部的醫院調色
      vec3 graded = col;
      graded = mix(graded, graded * vec3(0.86, 1.0, 1.04), smoothstep(0.35, 0.0, lum));
      graded = mix(graded, graded * vec3(1.06, 1.0, 0.9), smoothstep(0.4, 0.9, lum));
      col = mix(graded, vec3(lum), uDesat);
      // 受傷 / 被抓
      col = mix(col, vec3(lum * 1.3, lum * 0.08, lum * 0.06), uRed * 0.75);
      col += vec3(0.12, 0.0, 0.0) * uRed;
      // 暗角（心跳時收縮）
      float vig = smoothstep(0.85 - uPulse * 0.12, 0.25, d);
      col *= mix(1.0, vig, uVignette);
      // 底片顆粒（暗部比較明顯）
      float g = hash(uv * uRes + fract(uTime * 7.13) * 100.0) - 0.5;
      col += g * uGrain * (1.2 - lum);
      // 雜訊雪花
      col = mix(col, vec3(hash(uv * uRes * 0.5 + uTime)), uStatic * 0.22);
      // 掃描線
      col *= 1.0 - uStatic * 0.15 * step(0.5, fract(uv.y * uRes.y * 0.5));
      col = mix(col, vec3(1.0), uFlash);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.q = quality;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.55, 0.88);
      this.composer.addPass(this.bloom);
    }
    this.horror = new ShaderPass(HorrorShader);
    this.composer.addPass(this.horror);
    this.u = this.horror.uniforms;
  }
  setCamera(cam) { this.renderPass.camera = cam; }
  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.u.uRes.value.set(w * pr, h * pr);
  }
  render(dt) {
    this.u.uTime.value += dt;
    this.composer.render(dt);
  }
  dispose() {
    // EffectComposer.dispose() 不會釋放各個 pass（泛光的 mip 目標等），要自己來
    for (const p of this.composer.passes) if (p.dispose) p.dispose();
    this.composer.dispose();
  }
}
