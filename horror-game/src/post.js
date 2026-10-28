// 後製：泛光 + 恐怖濾鏡（抗鋸齒、色調映射、底片顆粒、暗角、色差、理智扭曲、雜訊、受傷紅光、調色）
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

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
    // 柔和的顆粒：在比像素稍大的格子上做平滑插值，不會變成一粒一粒刺眼的白點
    float grainNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    #ifdef FXAA
      // 快速抗鋸齒（FXAA，簡化版）：直接在這一道 pass 裡做，不多一次全螢幕繪製。
      // 輸入還是線性 HDR，所以先把亮度壓到 0..1 再比較對比
      float aaLuma(vec3 c) { float l = dot(c, vec3(0.299, 0.587, 0.114)); return sqrt(l / (1.0 + l)); }
      vec3 fxaa(vec2 uv, vec3 rgbM) {
        vec2 px = 1.0 / uRes;
        vec3 rgbNW = texture2D(tDiffuse, uv + vec2(-1.0, -1.0) * px).rgb;
        vec3 rgbNE = texture2D(tDiffuse, uv + vec2(1.0, -1.0) * px).rgb;
        vec3 rgbSW = texture2D(tDiffuse, uv + vec2(-1.0, 1.0) * px).rgb;
        vec3 rgbSE = texture2D(tDiffuse, uv + vec2(1.0, 1.0) * px).rgb;
        float lNW = aaLuma(rgbNW), lNE = aaLuma(rgbNE), lSW = aaLuma(rgbSW), lSE = aaLuma(rgbSE), lM = aaLuma(rgbM);
        float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
        float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
        // 對比太低（平坦區域）就不處理，省下後面的取樣
        if (lMax - lMin < max(0.04, lMax * 0.14)) return rgbM;
        vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
        float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
        float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
        dir = clamp(dir * rcp, vec2(-6.0), vec2(6.0)) * px;
        vec3 rgbA = 0.5 * (texture2D(tDiffuse, uv - dir * 0.1667).rgb + texture2D(tDiffuse, uv + dir * 0.1667).rgb);
        vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tDiffuse, uv - dir * 0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
        float lB = aaLuma(rgbB);
        return (lB < lMin || lB > lMax) ? rgbA : rgbB;
      }
    #endif
    void main() {
      vec2 uv = vUv;
      // 理智扭曲：緩慢的波動
      uv += uDistort * vec2(sin(uv.y * 18.0 + uTime * 1.7), cos(uv.x * 14.0 + uTime * 1.3)) * 0.0045;
      // 雜訊撕裂（類比錄影機）
      float band = step(1.0 - uStatic * 0.08, hash(vec2(floor(uv.y * 90.0), floor(uTime * 24.0))));
      uv.x += band * (hash(vec2(uTime, uv.y)) - 0.5) * 0.06 * uStatic;
      vec2 dir = uv - 0.5;
      float d = length(dir);
      vec3 base = texture2D(tDiffuse, uv).rgb;
      #ifdef FXAA
        vec3 col = fxaa(uv, base);
      #else
        vec3 col = base;
      #endif
      // 色差：只在畫面邊緣、而且偏移超過約半個像素時才多取樣（平常幾乎看不出來，理智崩潰時才明顯）
      float ab = uAberr * d * d * 0.014;
      if (ab * uRes.x > 0.5) {
        col.r += texture2D(tDiffuse, uv + dir * ab).r - base.r;
        col.b += texture2D(tDiffuse, uv - dir * ab).b - base.b;
        col = max(col, vec3(0.0));
      }
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
      // 底片顆粒（暗部比較明顯）：顆粒大小跟著解析度走（720p 約 1.4 像素），一秒換 24 次，不會滿畫面閃爍
      vec2 gp = uv * uRes / max(1.0, uRes.y / 720.0 * 1.4) + floor(mod(uTime * 24.0, 97.0)) * vec2(17.3, 41.9);
      float g = grainNoise(gp) - 0.5;
      col += g * uGrain * 0.9 * (1.1 - lum);
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
      // 高畫質用 4 倍多重取樣；關掉「抗鋸齒」時連多重取樣也不做（下一局生效）
      samples: quality.aa === false ? 0 : quality.msaa,
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
    this.setAA(quality.aa !== false);
  }
  // 低 / 中畫質沒有多重取樣：用最後一道 pass 裡的 FXAA 把鋸齒邊緣柔化
  setAA(on) {
    const want = on && !(this.q.msaa > 0 && this.q.aa !== false);
    const m = this.horror.material;
    if (('FXAA' in m.defines) === want) return;
    if (want) m.defines.FXAA = ''; else delete m.defines.FXAA;
    m.needsUpdate = true;
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
  // 相機照片（回傳 Promise）：先渲染到跟主畫面相同格式（半浮點、線性）的目標，共用已經編譯好的著色器，
  // 按快門時才不會因為重新編譯而卡住；再用一個小 pass 做色調映射與 sRGB，讀回 8 位元像素
  snapshot(scene, camera, W, H) {
    if (!this.snap) {
      const hdr = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
      const ldr = new THREE.WebGLRenderTarget(W, H);
      const mat = new THREE.ShaderMaterial({
        uniforms: { tSrc: { value: hdr.texture }, uExposure: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `
          uniform sampler2D tSrc; uniform float uExposure; varying vec2 vUv;
          vec3 fit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
          void main() {
            const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
            const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
            vec3 c = texture2D(tSrc, vUv).rgb * uExposure / 0.6;
            c = clamp(outM * fit(inM * c), 0.0, 1.0);
            c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
            gl_FragColor = vec4(c, 1.0);
          }`,
        toneMapped: false, depthTest: false, depthWrite: false,
      });
      this.snap = { hdr, ldr, mat, quad: new FullScreenQuad(mat), buf: new Uint8Array(W * H * 4) };
    }
    const S = this.snap, r = this.renderer, prev = r.getRenderTarget();
    S.mat.uniforms.uExposure.value = r.toneMappingExposure;
    // 陰影圖沿用這一格主畫面算好的，不重算一次
    const au = r.shadowMap.autoUpdate;
    try {
      r.shadowMap.autoUpdate = false;
      r.setRenderTarget(S.hdr);
      r.clear();
      r.render(scene, camera);
      r.setRenderTarget(S.ldr);
      S.quad.render(r);
    } finally {
      r.shadowMap.autoUpdate = au;
      r.setRenderTarget(prev);
    }
    // 非同步讀回（PBO + fence）：不必等 GPU 把前面的工作做完，按快門那一格不會頓
    if (r.readRenderTargetPixelsAsync) return r.readRenderTargetPixelsAsync(S.ldr, 0, 0, W, H, S.buf).then(() => S.buf);
    r.readRenderTargetPixels(S.ldr, 0, 0, W, H, S.buf);
    return Promise.resolve(S.buf);
  }
  dispose() {
    // EffectComposer.dispose() 不會釋放各個 pass（泛光的 mip 目標等），要自己來
    for (const p of this.composer.passes) if (p.dispose) p.dispose();
    if (this.snap) { this.snap.hdr.dispose(); this.snap.ldr.dispose(); this.snap.mat.dispose(); this.snap.quad.dispose(); }
    this.composer.dispose();
  }
}
