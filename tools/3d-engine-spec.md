# sev7en — spesifikasi renderer 3D (kerja internal)

Dokumen kerja untuk konversi tampilan game dari Canvas 2D menjadi 3D. Gameplay,
data soal, HUD DOM, dan protokol VS **tidak berubah**. Hanya lapisan render
(`drawSkyAndEnvironment`, `drawPlatform`, `drawStarPou`, partikel, teks) yang
diganti. Tujuannya: tampilan 3D sungguhan (kamera perspektif, geometri ber-volume,
kedalaman) tanpa dependency, tetap satu file HTML mandiri dan jalan offline.

## Prinsip

- Software 3D di Canvas 2D: proyeksi perspektif + painter's algorithm + flat
  shading + garis tepi toon. Tanpa WebGL, tanpa three.js, tanpa build step.
- Semua fisika/game logic, skor, streak, soal, VS, timer **tidak disentuh**.
- Bentuk objek 3D: pulau rumput low-poly, awan billboard, tangga awan berupa slab
  3D, bintang karakter = prisma bintang (extruded 5-point star), partikel kuad 3D.

## Sistem koordinat

- World gameplay memakai `(wx, wy)` lama: `wx` kiri/kanan, `wy` negatif ke atas.
- World 3D: `x = wx`, `y = -wy`, `z = 0` untuk bidang permainan (kanan, atas, depan).
- `gameTo3D(wx, wy, wz = 0)` → `{x, y, z}`.
- Kamera berada di `z > 0` menghadap ke `-z`.

## Kamera

Global `camera3D` dihitung tiap frame oleh `updateCameraRig()`:

```
camera3D = { eye, target, fwd, right, up, focal, near, fov, dist, yaw, pitch, scale }
```

- `fov = 55°`, `focal = (H/2) / tan(fov/2)`, `near = 20`.
- Titik bidik: `aim = (cam.x, -cam.y + AU, 0)`, `AU = STEP_Y * 0.86` (≈180.6).
- `eye = aim + (sin(yaw)*dist, EYE_ABOVE, cos(yaw)*dist)`, `EYE_ABOVE = 160`.
- `yaw` kecil (≤ 10°): orbit halus `sin(t*0.00018)*3°`. Membuat scene tidak
  terasa datar.
- Jarak adaptif terhadap viewport supaya dua pad jawaban tetap muat:
  `sVert = (H >= 520 ? 0.33 : 0.30) * H / (STEP_Y*0.86)`,
  `sHoriz = 0.46*W / (STEP_X + platHalf)`,
  `s = clamp(min(sVert, sHoriz), 0.5, 1.75)`, `dist = max(340, focal / s)`.
- `forward = normalize(aim - eye)`; `right = normalize(cross(forward, worldUp))`;
  `up = cross(right, forward)`.

## Proyeksi

```
d  = p - eye
xv = dot(d, right); yv = dot(d, up); zv = dot(d, fwd)
screen.x = W/2 + xv * focal / zv
screen.y = H/2 - yv * focal / zv
scale    = focal / zv
```

- `projectPoint(p3)` → `{x, y, depth: zv, scale}` atau `null` bila `zv < near`.
- `projectGamePoint(wx, wy, wz = 0)` = `projectPoint(gameTo3D(...))`.
- Near clipping: Sutherland–Hodgman terhadap `zv = near` di view space,
  `clipPolygonNear(pts3)` → array titik 3D (tetap di world space).
- Urutan gambar: painter's algorithm, jauh → dekat (tidak ada depth buffer).

## Material & cahaya

- Flat shading toon, outline `#0f172a`, tebal 2.5–3.5 px layar.
- `LIGHT_DIR = normalize(-0.35, 0.80, 0.45)` (dari atas-kiri-depan).
- `brightness = 0.62 + 0.38 * max(0, dot(n, LIGHT_DIR))`; `shadeHex(hex, k)`
  mengembalikan `rgb(...)`.
- `mixHex(a, b, t)`, `lerpColor(hex1, hex2, f)` (lama) tetap ada.
- Fog tipis hanya untuk objek latar: campur warna ke `zonePalette(alt).fog`
  dengan `fogT = clamp((zv - 900) / 1800, 0, 0.65)`.

## Zona langit

`altitudePx = max(0, -cam.y)`; ambang sama dengan versi 2D: `900`, `1800`, `2700`.

`zonePalette(altitudePx)` mengembalikan:

```
{ top, bottom, fog, cloudTint, starAlpha, planetAlpha, cosmic, name }
```

- top/bottom memakai interpolasi warna persis seperti versi 2D (`lerpColor`).
- `starAlpha` 0 sampai 1100, naik linear sampai ~1 di 2100.
- `planetAlpha` 0 sampai 2000 (bulan) dan 2000+ (planet bercincin).
- `cloudTint` putih (bumi) → oranye (senja) → ungu nebula (luar angkasa).

## Geometri

- **Pulau bumi**: piringan 24 sisi di `y = 0` (rumput), skirt tanah ke bawah 120,
  beberapa bukit low-poly + pohon kecil; hanya terlihat saat rendah.
- **Awan latar**: billboard sprite (sprite offscreen di-cache, 3 varian tint),
  posisi 3D dari data `bgClouds` lama (`x = offsetX*1.6`, `y = -worldY`,
  `z = -300 - hash*2200`), drift horizontal tiap frame, skala perspektif.
- **Slab platform**: alas oktagon (rounded box 3D) dengan tebal `p.h`, kedalaman
  `170` (±85 z), warna menurut status/level (start kuning, correct hijau,
  wrong merah, level ≥ 12 ungu kosmik, netral putih), plus 3–5 puff awan
  billboard di tepinya. Label `TANGGA n`/`START` digambar di permukaan atas.
- **Pilihan jawaban**: slab yang sama + papan tanda billboard di atasnya berisi
  teks jawaban. Lebar render `min(p.w, STEP_X*1.7)` supaya muat di layar sempit;
  teks skala perspektif dengan clamp ukuran font.
- **Karakter Star-Pou**: prisma bintang 5 sudut (outer 45, inner 25, tebal 26,
  depan `z=+13`), outline toon, muka (mata/blush/mulut per `star.expression`)
  digambar sebagai overlay 2D di tengah muka depan, ikut `star.scaleX/scaleY`
  (squash/stretch) dan `star.rotation` (spinning saat jatuh). Shadow ellipse di
  permukaan platform.
  - **Orientasi berdiri**: satu ujung luar menghadap ke atas (`a = i*π/5 + π/2`),
    sehingga **dua ujung tajam** berada di bawah sebagai kaki yang menapak di
    platform (bukan bertumpu pada satu ujung). Puncak dalam di antara kedua kaki
    membentuk lekuk `V` di tengah bawah.
  - `bob` (naik-turun saat idle) ikut diterapkan di mesh, bukan hanya muka, supaya
    badan dan wajah tetap sinkron.
- **Panduan lompat**: kurva bezier 3D dari puncak base ke puncak dua pilihan,
  `setLineDash([8,8])`, hanya saat `star.state === 'idle'`.
- **Konfeti**: kuad kecil 3D dengan rotasi + gravitasi; field partikel lama
  (`wx, wy, vx, vy, size, color, life`) dipertahankan, tambah `wz`.
- **Teks melayang**: billboard 3D yang naik.

## Urutan render per frame

1. langit (gradien); 2. bintang latar + bulan/planet; 3. awan latar (jauh→dekat);
4. pulau bumi; 5. panduan lompat; 6. platform (urut jauh→dekat); 7. shadow +
karakter; 8. konfeti; 9. teks melayang; 10. awan foreground + vignette.

## Performa

- DPR maksimal 2, `ctx.setTransform(dpr,0,0,dpr,0,0)` di awal frame.
- Cache: sprite awan/glow offscreen, mesh platform di `p._mesh3d` (lazy).
- Target ≤ ~400 draw call per frame, 60 fps di laptop kelas sekolah.
- Game tetap jalan penuh tanpa WebGL / GPU (software canvas).

## Kontrak fungsi (dipakai unit test — nama harus persis)

```
gameTo3D(wx, wy, wz = 0)          -> {x, y, z}
updateCameraRig()                 -> menulis global camera3D
projectPoint(p3)                  -> {x, y, depth, scale} | null
projectGamePoint(wx, wy, wz = 0)  -> {x, y, depth, scale} | null
clipPolygonNear(pts3)             -> Array<p3>
drawPoly3(pts3, fill, opts?)      -> void
shadeHex(hex, k)                  -> 'rgb(r,g,b)'
mixHex(a, b, t)                   -> 'rgb(r,g,b)'
zonePalette(altitudePx)           -> objek zona (lihat di atas)
platformMesh(p)                   -> {faces: [{pts, kind}], ...} (cache p._mesh3d)
starMesh()                        -> {faces: [{pts, kind}]} prisma bintang
sortByDepth(items, getDepth)      -> Array (jauh → dekat)
drawSkyAndEnvironment(t)          -> void  (tetap ada)
drawPlatform(p, isOption)         -> void  (tetap ada, no-op untuk null)
drawStarPou(t)                    -> void  (tetap ada)
animate(t)                        -> void  (tetap ada)
```

Konstanta: `CAM_FOV_DEG = 55`, `CAM_NEAR = 20`, `ZONE_STEPS = [900, 1800, 2700]`,
`LIGHT_DIR` (ternormalisasi), `STEP_Y = 210` (tetap), `STEP_X` (tetap adaptif W).

`cam` tetap berbentuk `{ x, y, targetX, targetY }` (deepEqual di test lama).
`initEnvironment()` tetap menghasilkan 18 awan dan 120 bintang dengan rentang
field yang sama seperti versi 2D (test lama memeriksanya).

## Nilai final implementasi (verifikasi terhadap `game.html`)

Angka di bawah ini adalah nilai yang benar-benar dipakai kode final:

| Hal | Nilai |
| --- | --- |
| FOV / near | `CAM_FOV_DEG = 55`, `CAM_NEAR = 20` |
| `EYE_ABOVE` | `160` |
| `AU` (aim di atas base) | `STEP_Y * 0.86` = 180.6 |
| Skala layar `s` | `clamp(min((H>=520?0.33:0.30)*H/180.6, 0.46*W/(STEP_X+platHalf)), 0.5, 1.75)` |
| `dist` | `max(340, focal / s)`, `focal = (H/2)/tan(27.5°)` |
| Radius pulau | `max(1200, dist*2.0)`; skirt tanah turun 230 |
| Aerial haze pulau | `clamp((eyeY-300)/1900, 0, 0.8)`; pulau tidak digambar bila `eyeY > 3000` |
| Tebal render slab | 20 (start: 26), kedalaman slab 170 (±85) |
| Chamfer oktagon slab | `min(halfW, halfD) * 0.40` |
| Cloud sprite | 192×128 px, 6 blob radial (cache per tint) |
| Awan latar (dunia) | `x = cam.x + offsetX*1.45`, `y = -worldY`, `z = -800..-2800`; ukuran `780*scale`, alpha `0.34*fog` |
| Awan depan | `z = eye.z - (210..350)`, ukuran `95*scale`, alpha 0.15 |
| Bulan | dunia `(1700, 3400, -2800)`, radius 175 |
| Planet bercincin | dunia `(-2300, 3300, -3200)`, radius 215, ring `ellipse(r*1.9, r*0.42)` |
| Matahari senja | dunia `(-2300, 1450, -3200)`, radius 130 |
| DPR | `min(2, devicePixelRatio)`; `canvas.width = round(W*DPR)` |
| FPS terukur (Edge headless, tanpa GPU) | ±55 fps pada 1280×800 |

Catatan: `p._mesh3d` menyimpan `{ rw, wy, faces, topY, halfW, halfD }` dan
dibangun ulang bila `rw` atau `wy + fallY` berubah.

## Build solo

`game.html` diberikan penanda `<!-- @vs-only -->` … `<!-- @/vs-only -->` untuk
blok khusus mode VS. `tools/sync-solo.mjs` menghapus semua blok itu lalu menulis
`star_pou_sky_climber.html`; `star_pou_vs.html` = salinan persis `game.html`.
