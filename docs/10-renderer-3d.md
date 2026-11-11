# 10 · Renderer 3D (Software)

Dokumen ini menjelaskan lapisan tampilan 3D di `game.html`: renderer 3D **software**
yang digambar ke Canvas 2D biasa, tanpa WebGL, tanpa three.js, tanpa build step.
Gameplay, soal, skor, HUD, mode VS, dan protokol WebSocket **tidak berubah** — yang
berubah hanya cara dunia digambar.

Dokumen ini untuk developer yang ingin mengubah tampilan (kamera, warna, geometri)
atau memeriksa kenapa render terasa lambat. Spesifikasi kerja aslinya ada di
`tools/3d-engine-spec.md`.

---

## 1. Prinsip dan batasan

- Semua gambar digambar lewat `CanvasRenderingContext2D` (`ctx`) yang sama seperti
  versi 2D dulu. Tidak ada GPU shader, tidak ada tekstur, tidak ada depth buffer.
- Efek 3D dibentuk dari empat teknik sederhana:
  1. **proyeksi perspektif** — titik world diproyeksikan ke layar;
  2. **painter's algorithm** — objek jauh digambar lebih dulu, objek dekat menimpa;
  3. **flat shading** — tiap bidang diwarnai satu warna berdasarkan arah cahaya;
  4. **outline toon** — garis tepi gelap di setiap muka bidang.
- Tetap **satu file HTML mandiri**, jalan offline di laptop sekolah tanpa GPU.
- Konsekuensi: tidak ada bayangan real-time, tidak ada tekstur, dan urutan gambar
  harus diatur manual (lihat §5).
- Semua fisika/game logic (`star`, `cam`, skor, timer, VS) tetap di dunia 2D lama;
  renderer hanya membacanya lalu memproyeksikannya.

| Aspek | Nilai |
|---|---|
| Teknologi | Canvas 2D + matematika 3D manual |
| Dependency | Tidak ada |
| Build step | Tidak ada (inline di `game.html`) |
| Depth buffer | Tidak ada — pakai depth sort |
| Target frame | ~60 fps, ≤ ~400 draw call per frame |
| DPR maksimum | 2 |

---

## 2. Sistem koordinat

Gameplay tetap memakai koordinat world lama `(wx, wy)`:

- `wx` bertambah ke **kanan** layar;
- `wy` bertambah ke **bawah** layar (negatif = makin tinggi);
- `cam.y` negatif saat pemain naik, sehingga `-cam.y` = ketinggian.

Renderer memakai ruang 3D dengan sumbu:

| Sumbu 3D | Arah | Hubungan |
|---|---|---|
| `x` | kanan | `x = wx` |
| `y` | atas | `y = -wy` |
| `z` | depan (mendekati kamera) | `z = 0` untuk bidang permainan |

Konversi dilakukan oleh `gameTo3D(wx, wy, wz = 0)`:

```js
gameTo3D(0, 0)      // { x: 0,   y: 0,    z: 0 }
gameTo3D(0, -1050)  // { x: 0,   y: 1050, z: 0 }  // 5 tangga di atas tanah
```

Kamera berada di `z > 0` dan menghadap ke arah `-z`. Jadi pemain melihat "panggung"
dari depan, sedikit dari atas — bukan tampilan samping datar.

---

## 3. Kamera

Kamera dihitung ulang setiap frame oleh `updateCameraRig()` dan disimpan di global
`camera3D`:

```js
camera3D = {
  eye, target, fwd, right, up,   // vektor 3D
  focal, near, fov,              // proyeksi
  dist, yaw, pitch, scale        // rig
}
```

### 3.1 Titik bidik dan mata kamera

```
AU   = STEP_Y * 0.86                // ≈ 180,6 px di dunia
aim  = (cam.x, -cam.y + AU, 0)
eye  = aim + (sin(yaw) * dist, EYE_ABOVE, cos(yaw) * dist)
```

- `AU` menaruh titik bidik sedikit di atas posisi kamera world, supaya platform
  yang sedang dituju ada di tengah layar (bukan pemain yang menempel di bawah).
- `EYE_ABOVE = 160` adalah offset vertikal mata kamera terhadap titik bidik, supaya
  kamera berada di atas bidang permainan dan muka atas platform (tempat teks
  `TANGGA n`/jawaban) terlihat jelas.
- `dist` tidak tetap: dihitung adaptif terhadap ukuran viewport (§3.3).

### 3.2 Sudut pandang

- `CAM_FOV_DEG = 55` (derajat); `camera3D.fov` menyimpan angka 55 itu sebagai
  penanda, sedangkan `focal` dihitung dengan sudut dalam radian.
- `focal = (H / 2) / tan(fov / 2)` — panjang fokus dalam piksel layar.
- `near = CAM_NEAR = 20` — jarak minimum objek agar tidak terpotong aneh (§4.2).
- `yaw` kecil (maksimal sekitar 3°): orbit halus
  `yaw = sin(t * 0.00018) × 3°`. Efeknya scene tidak terasa seperti poster datar.
  `t` adalah waktu dari `requestAnimationFrame`; `updateCameraRig()` boleh dipanggil
  tanpa argumen (`t` dianggap 0).
- `pitch` diturunkan dari arah pandang (`asin(-fwd.y)`); tidak diatur manual.

### 3.3 Jarak kamera adaptif

Dua platform jawaban harus tetap muat di layar, termasuk di jendela sempit atau HP
portrait. Karena itu jarak kamera dihitung dari viewport:

```
platHalf = min(250, STEP_X × 1.7) / 2
sVert    = ((H >= 520 ? 0.33 : 0.30) × H) / (STEP_Y × 0.86)
sHoriz   = (0.46 × W) / (STEP_X + platHalf)
s        = max(0.5, min(1.75, min(sVert, sHoriz)))
dist     = max(340, focal / s)
```

- `sVert` membatasi seberapa besar satu tangga (jarak `STEP_Y × 0.86`) boleh
  tampil secara vertikal. Layar pendek (`H < 520`, mis. HP landscape) memakai
  faktor `0.30` agar papan jawaban tidak tertutup banner pertanyaan.
- `sHoriz` menjaga lebar dua pilihan jawaban beserta setengah lebar platform tetap
  di dalam layar.
- `s` diklem 0.5–1.75 supaya kamera tidak terlalu dekat/jauh di viewport ekstrem.
- `dist` minimal **340** supaya kamera tidak "menempel" ke pemain.

### 3.4 Basis kamera

```
fwd   = normalize(aim - eye)
right = normalize(cross(fwd, worldUp))   // worldUp = (0, 1, 0)
up    = cross(right, fwd)
```

Ketiga vektor ini dipakai oleh proyeksi (§4). `cam` sendiri **tetap** berbentuk
`{ x, y, targetX, targetY }` seperti versi 2D — rig 3D hanya turunannya, sehingga
logic kamera lama dan test lama tidak perlu berubah.

---

## 4. Proyeksi perspektif

### 4.1 Rumus

Untuk setiap titik world `p`:

```
d  = p - eye
xv = dot(d, right)
yv = dot(d, up)
zv = dot(d, fwd)          // kedalaman di depan kamera

screen.x = W/2 + xv * focal / zv
screen.y = H/2 - yv * focal / zv
scale    = focal / zv     // faktor skala objek pada kedalaman itu
```

Fungsi publik:

| Fungsi | Hasil |
|---|---|
| `projectPoint(p3)` | `{ x, y, depth, scale }`, atau `null` bila `depth < near` |
| `projectGamePoint(wx, wy, wz = 0)` | sama, tetapi menerima koordinat game |
| `gameTo3D(wx, wy, wz = 0)` | konversi world game → world 3D |

`scale` dipakai untuk menyesuaikan ukuran objek: teks, tebal outline, radius
partikel, dan tebal garis. Objek yang lebih dekat otomatis lebih besar.

### 4.2 Near clipping

Titik dengan `zv < near` tidak boleh diproyeksikan (hasil bagi negatif akan
melempar koordinat ke luar layar). Polygon yang sebagian berada di belakang kamera
dipotong dengan **Sutherland–Hodgman** terhadap bidang `zv = near`:

```
clipPolygonNear(pts3) -> Array<p3>
```

- Input dan output tetap titik 3D di world space.
- Polygon yang seluruhnya di depan kamera dikembalikan utuh.
- Polygon yang seluruhnya di belakang kamera menjadi array kosong (tidak digambar).
- Dipakai `drawPoly3()` sebelum proyeksi supaya platform yang lewat dekat kamera
  tidak "meledak" menjadi bentuk aneh saat kamera naik.

`drawPlatform()` melakukan **culling** sederhana: platform yang jarak vertikalnya
terlalu jauh dari kamera (lebih dari **4200 px**) atau titik pusatnya gagal
diproyeksikan (di belakang near plane) dilewati tanpa `ctx.save()`/draw call.
Objek latar (awan, bintang) juga dilewati bila `projectPoint()` mengembalikan
`null`, sehingga naik tangga tidak membebani render dengan objek tak terlihat.

---

## 5. Painter's algorithm (urutan kedalaman)

Tidak ada depth buffer, jadi urutan gambar menentukan hasil akhir:

- Kumpulan objek diurutkan **jauh → dekat** memakai `depth` (`zv`) dari proyeksi.
- Helper `sortByDepth(items, getDepth)` mengembalikan array terurut tersebut.
- Platform, awan latar, partikel, dan teks melayang masing-masing diurutkan sebelum
  digambar.
- Konsekuensi yang perlu diingat: objek besar yang saling menembus bisa salah
  urutan. Untuk scene ini (platform terpisah, kamera dari depan) hasilnya stabil.
- Panduan lompat (garis putus-putus) sengaja digambar **sebelum** platform supaya
  selalu terlihat di belakang platform tujuan.

---

## 6. Shading toon, outline, dan fog

### 6.1 Arah cahaya dan kecerahan

```
LIGHT_DIR = normalize(-0.35, 0.80, 0.45)   // dari atas-kiri-depan
```

- `LIGHT_DIR` didefinisikan dan dinormalisasi, lalu **benar-benar dipakai** untuk
  menghitung kecerahan sisi miring (unit test memeriksa panjangnya ±1).
- Helper `faceBrightness(pts, fallback)` menghitung normal muka dari tiga titik
  pertama (`normalize(cross(p1-p0, p2-p0))`) lalu:

  ```
  k = 0.58 + 0.42 × |dot(normal, LIGHT_DIR)|
  ```

  `fallback` dipakai bila polygon punya kurang dari 3 titik. Nilai absolut membuat
  kedua arah sisi sama-sama mendapat rentang 0.58–1.00.
- Muka atas dan bawah platform **tetap** memakai nilai tetap agar kontras toon
  stabil:
  - platform: muka atas `1.00`, bawah `0.50`, sisi miring `faceBrightness(..., 0.76)`;
  - prisma bintang: muka depan `1.00`, muka belakang `0.62`, sisi `faceBrightness(..., 0.72)`.
- `shadeHex(hex, k)` mengalikan tiap kanal RGB dengan `k` (diklem 0–1,4 lalu
  dibulatkan, maksimum 255) dan mengembalikan string `rgb(r,g,b)`.
- `mixHex(a, b, t)` menginterpolasi dua warna; `lerpColor(hex1, hex2, f)` lama
  tetap tersedia untuk gradien langit.

### 6.2 Outline toon

Setiap muka digambar dengan:

1. `ctx.fill()` memakai warna hasil shading;
2. `ctx.stroke()` dengan `outline = #0f172a`, tebal **2,4–3,4 px** layar
   (platform `2.4`, sisi bintang `2.6`, muka belakang bintang `3`, muka depan
   bintang `3.4`).

Garis tepi inilah yang memberi kesan kartun/toon, bukan realistis.

### 6.3 Fog latar

Tidak ada rumus fog global; kabut diterapkan hanya pada objek latar:

- **Awan latar**: alpha sprite dihitung dengan
  `fog = max(0.16, 1 - max(0, depth - 500) / 2400)`, lalu `alpha = 0.34 × fog`.
  Awan yang lebih jauh tampil lebih pudar; batas bawah 0.16 mencegahnya hilang
  total.
- **Pulau bumi**: warna rumput/skirt/bukit dicampur dengan `zonePalette(-cam.y).fog`
  (warna `bottom` langit) sebanding dengan jarak kamera (`fade`), sehingga pulau
  menyatu dengan langit saat kamera naik.
- Warna kabut ikut zona langit, jadi transisi siang → senja → luar angkasa terasa
  menyatu.

---

## 7. Zona langit

Zona ditentukan dari **ketinggian kamera**, bukan langsung dari `floorLevel`:

```
altitudePx = max(0, -cam.y)
```

Ambangnya sama dengan versi 2D, disimpan di `ZONE_STEPS = [900, 1800, 2700]`.
`zonePalette(altitudePx)` mengembalikan satu objek:

```js
{
  top, bottom,       // warna gradien langit (string CSS)
  fog,               // warna kabut (= bottom)
  cloudTint,         // tint sprite awan
  starAlpha,         // 0..1 — bintang & bulan
  planetAlpha,       // 0..1 — planet bercincin
  sunset,            // 0..1 — intensitas matahari senja
  cosmic,            // boolean, true di zona luar angkasa
  name               // nama zona
}
```

| `altitudePx` | Zona | `cosmic` | Nuansa |
|---|---|---|---|
| `< 900` | Bumi & Rumput | `false` | biru siang → biru tinggi |
| `900–1799` | Langit Awan | `false` | biru → senja stratosfer |
| `1800–2699` | Atmosfer Senja | `false` | senja → malam dalam |
| `≥ 2700` | Luar Angkasa | `true` | luar angkasa gelap |

Catatan perilaku (diambil dari implementasi final):

- `starAlpha = clamp((altitudePx - 1100) / 1000, 0, 1)` → 0 di dataran rendah,
  0.5 pada 1600 px, dan 1 pada 2100 px ke atas. Bintang latar dan bulan memakai
  nilai ini.
- `planetAlpha = clamp((altitudePx - 2000) / 900, 0, 1)` → **planet bercincin**
  baru muncul di atas 2000 px dan penuh pada 2900 px.
- `sunset = clamp((altitudePx - 900) / 700) × clamp((2500 - altitudePx) / 1100)` —
  puncaknya di ketinggian menengah; dipakai untuk matahari senja yang memudar.
- `cloudTint`: `#ffffff` (putih, dataran rendah), `#fdba74` (oranye, di atas
  1100 px), `#a78bfa` (ungu, di atas 2200 px).
- `top`/`bottom` memakai interpolasi warna yang sama persis dengan versi 2D
  (`lerpColor`), sehingga transisi tidak "patah" di batas zona.

### 7.1 Benda langit

Posisi semua benda langit dalam koordinat dunia 3D (bukan layar), jadi ikut
bergerak saat kamera naik:

| Objek | Posisi dunia | Radius | Kapan tampil |
|---|---|---|---|
| Bintang latar | 120 titik `spaceStars` (field lama) | 1–3,5 px | `starAlpha > 0.01` |
| Matahari senja | `(-2300, 1450, -3200)` | `130 × scale` | `sunset > 0.02` |
| Bulan | `(1700, 3400, -2800)` | `175 × scale` | `starAlpha > 0.05` |
| Planet bercincin | `(-2300, 3300, -3200)` | `215 × scale` | `planetAlpha > 0.05` |

- Bulan diberi glow sprite dan planet diberi cincin `ellipse(r × 1.9, r × 0.42)`.
- Bintang berkelip (`sin(t × blinkSpeed + phase)`) dan bergeser sedikit mengikuti
  `yaw` kamera.

> Hubungan dengan HUD: badge zona di HUD memakai `floorLevel` (ambang 4 / 8 / 12),
> sedangkan langit memakai `altitudePx` kamera (ambang 900 / 1800 / 2700 px).
> Keduanya sengaja tidak identik — langit bergerak halus mengikuti kamera,
> badge berubah per tangga. Satu tangga = `STEP_Y = 210` px, jadi 900 px ≈ 4,3
> tangga; itulah sebabnya badge "Langit Awan" muncul sekitar saat langit mulai
> berubah.

---

## 8. Geometri 3D

### 8.1 Pulau bumi

- Piringan **20 sisi** dengan radius `R = max(1200, camera3D.dist × 2.0)` di
  `y = 0` (bidang rumput ikut melebar saat kamera menjauh).
- Skirt tanah menjulang ke bawah **230 px** supaya terlihat seperti pulau
  mengambang, bukan garis tanah datar.
- Permukaan rumput digambar sebagai fan segitiga, ditambah rim rumput lebih
  terang di tepi pulau, **3 bukit low-poly** (kerucut 10 sisi + tutup), dan
  **5 pohon kecil** (batang kotak + 3 lapis kerucut 6 sisi).
- Warna dicampur dengan `zonePalette(-cam.y).fog` memakai **aerial haze**
  `clamp((eyeY - 300) / 1900, 0, 0.8)`; pulau berhenti digambar ketika
  `camera3D.eye.y > 3000`.

### 8.2 Awan latar dan awan depan

- **Billboard sprite**: awan digambar sekali ke canvas offscreen berukuran
  `192×128` (`makeCloudSprite(tint)`, 6 blob radial), lalu di-cache di
  `spriteCache` per tint. `makeGlowSprite(color)` (`128×128`) dipakai untuk glow
  bulan/matahari.
- **Awan latar** (`bgClouds`, 18 buah dari `initEnvironment()`, field lama plus
  `worldZ` acak `-(800 + random × 2000)` = rentang **-800…-2800**):
  - posisi 3D `{ x: cam.x + offsetX × 1.45, y: -worldY, z: worldZ }`;
  - `offsetX` bergeser tiap frame sesuai `speed`, memantul di `±W`;
  - ukuran dunia `620 × scale`, alpha `0.34 × fog` dengan
    `fog = max(0.16, 1 - max(0, depth - 500) / 2400)`;
  - diurutkan **jauh → dekat** sebelum digambar.
- **Awan depan** (`fgClouds`, 4 buah): `z = camera3D.eye.z - zOff`
  (`zOff = 210…350`, jadi berada di antara kamera dan scene),
  `x = cam.x + offsetX` dengan `offsetX` di kiri/kanan layar, `y = eye.y + offsetY`
  (`-320…-170`), ukuran `95 × scale`, alpha tetap **0.15**. Lapisan ini
  memperkuat kesan kedalaman.
- Skala sprite mengikuti `scale` proyeksi, jadi awan membesar saat dekat kamera.

### 8.3 Slab platform (tangga)

- Alas berupa **oktagon ber-chamfer** (8 titik, chamfer
  `min(halfW, halfD) × 0.40`), kedalaman **170** px (`halfD = 85`, dari
  `z = -85` sampai `z = +85`).
- **Tebal render** slab: platform start **26**; platform lain **20**. Angka ini
  tebal tampilan renderer, **tidak sama** dengan `p.h` pada data platform
  (gameplay tetap memakai `p.h`).
- Warna menurut status/level:

  | Status | Atas | Sisi | Rim |
  |---|---|---|---|
  | `start` | `#fde047` | `#eab308` | `#ca8a04` |
  | `correct` | `#4ade80` | `#22c55e` | `#15803d` |
  | `wrong` | `#f87171` | `#ef4444` | `#b91c1c` |
  | level ≥ 12 | `#c084fc` | `#a855f7` | `#6b21a8` |
  | netral | `#f8fafc` | `#dbe4ee` | `#94a3b8` |

- **5 puff awan** billboard di tepi alas (ukuran `min(130, max(70, rw × 0.42))`).
- Label `TANGGA n` / `START (0m)` digambar di permukaan atas platform **non-jawaban**
  (mengikuti perspektif; ukuran font diklem 9–20 px).
- Mesh di-cache lazy di `p._mesh3d` dan dibangun ulang bila `rw`/`wy` berubah.
- Hanya platform 8 tangga terakhir yang disimpan di riwayat gambar (perilaku lama).

### 8.4 Pilihan jawaban

- Memakai slab yang sama, ditambah **papan tanda** (rounded rect 2D di layar, posisi
  diproyeksikan dari `topY + 62`) berisi teks jawaban.
- Lebar render slab dibatasi `min(p.w, STEP_X × 1.7)`; papan tanda maksimal
  `W × 0.56` agar dua pilihan tetap muat di jendela sempit.
- Ukuran font mengecil otomatis (loop sampai 14 iterasi, minimum 10 px) bila teks
  terlalu panjang.
- Di permukaan atas platform (`z = 44`) ada petunjuk arah
  `⬅ LOMPAT KIRI` / `LOMPAT KANAN ➡`.

### 8.5 Karakter Star-Pou

- **Prisma bintang 5 sudut** (extruded 5-point star) dengan **12 muka**
  (1 belakang + 10 sisi + 1 depan):
  - radius luar **45**, radius dalam **25**,
  - tebal **26** (`halfT = 13`),
  - muka depan di `z = +13`.
- **Orientasi berdiri:** satu ujung luar menghadap ke atas (sudut titik
  `i*π/5 + π/2`), sehingga **dua ujung tajam** ada di bawah dan menjadi kaki yang
  menapak di permukaan platform — bukan bertumpu pada satu ujung. Lekuk `V` di
  antara kedua kaki dibentuk oleh puncak dalam bintang pada sudut 270°.
- Outline toon di semua sisi; warna kuning dengan tiga tingkat shading (§6.1).
- Karakter bergoyang sedikit: `yaw = sin(t × 0.0016) × 0.14`.
- Wajah (mata/blush/mulut sesuai `star.expression`: happy/win/jump/dizzy) digambar
  sebagai **overlay 2D** di muka depan (diproyeksikan di `z = 14`), mengikuti
  `star.scaleX/scaleY` (squash & stretch) dan `star.rotation` (berputar saat jatuh).
- Shadow ellipse radial-gradient di permukaan platform, hanya saat `idle` atau
  `celebrating`.
- Saat `idle`, karakter naik-turun halus (`bob = sin(t × 0.008) × 2.2`); nilai
  `bob` diterapkan ke **mesh 3D** (lewat `star._bob`), jadi badan dan wajah ikut
  bergerak bersama.

### 8.6 Panduan lompat

- Kurva **quadratic bezier 3D** dari puncak platform asal ke puncak dua platform
  pilihan, dengan titik kontrol `y` di tengah +130 dan `z = 70`.
- Disampel 16 titik lalu diproyeksikan per titik.
- Digambar putus-putus `setLineDash([8, 8])`, warna putih transparan.
- Hanya muncul saat `star.state === 'idle'`.

### 8.7 Konfeti dan teks melayang

- Konfeti = kuad kecil 3D dengan gravitasi. Tiap ledakan membuat **30 partikel**
  dengan field lama (`wx, wy, vx, vy, size, color, life`) ditambah `wz`
  (`±75`) untuk kedalaman.
- Tiap frame: `wx += vx`, `wy += vy`, `vy += 0.35`, `life -= 0.022`; partikel yang
  `life <= 0` dibuang. Ukuran layar `max(2, size × scale × 0.55)`.
- Teks melayang (`+120 NAIK!`, `AWAN HANCUR!`) = billboard 3D di `z = 0`; tiap
  frame naik `1.8` dan alpha turun `0.02`. Ukuran font diklem 14–42 px.

---

## 9. Urutan render satu frame

`animate(t)` menjalankan urutan berikut:

| # | Langkah | Kode |
|---|---|---|
| 0 | Set transform DPR, ease kamera (8% per frame), hitung rig 3D | `ctx.setTransform(DPR,…)`, `cam`, `updateCameraRig(t)` |
| 1 | Langit, bintang, matahari senja, bulan, planet, awan latar | `drawSkyAndEnvironment(t)` |
| 2 | Pulau bumi (selama masih terlihat) | `drawGroundIsland()` |
| 3 | Panduan lompat (hanya saat idle) | `drawJumpGuides()` |
| 4 | Platform, urut jauh → dekat, termasuk 2 pilihan jawaban | `sortByDepth`, `drawPlatform()` |
| 5 | Update fisika lompat/jatuh + squash/stretch + yaw karakter | `animate()` |
| 6 | Shadow + karakter bintang | `drawStarPou(t)` |
| 7 | Konfeti | `drawParticles()` |
| 8 | Teks melayang | `drawFloatingTexts()` |
| 9 | Awan foreground + vignette | `drawForegroundClouds()`, `drawVignette()` |

Langkah 1–2 menghasilkan latar, 3–6 dunia permainan, 7–9 efek penutup. Kamera dan
fisika karakter diperbarui di frame yang sama, jadi semua lapisan memakai posisi
terkini. HUD (skor, timer, badge zona, banner soal) digambar browser sebagai DOM,
bukan oleh renderer ini.

---

## 10. Performa dan DPR

- **DPR maksimal 2**, diatur di `resizeViewport()`:
  `DPR = min(2, devicePixelRatio || 1)` (fallback 1 bila nilainya tidak wajar),
  canvas backing store `round(W × DPR) × round(H × DPR)`, lalu
  `ctx.setTransform(DPR, 0, 0, DPR, 0, 0)` di awal setiap frame. Koordinat gambar
  tetap memakai ukuran CSS (px), jadi tata letak tidak berubah. `resizeViewport()`
  juga memperbarui `W`, `H`, dan `STEP_X`, serta dipanggil ulang saat window
  di-resize.
- **Cache offscreen**: `spriteCache` menyimpan sprite awan (`192×128`) dan glow
  (`128×128`) per warna; mesh platform di-cache lazy di `p._mesh3d` dan dibangun
  ulang hanya bila lebar render atau posisi vertikalnya berubah; prisma bintang
  dibangun per frame (murah, 12 muka).
- **Culling**: platform dengan jarak vertikal > 4200 px atau titik pusat yang gagal
  diproyeksikan tidak digambar; sprite latar dilewati bila `projectPoint()`
  mengembalikan `null`; polygon yang terpotong menyisakan < 3 titik tidak digambar.
- Target desain: **≤ ~400 draw call per frame** dan ~60 fps di laptop kelas sekolah
  (target, bukan angka yang dijamin di semua perangkat).
- Pada pengujian dengan **Edge headless tanpa GPU** di viewport 1280×800, skenario
  `fps` di `tools/capture3d.mjs` mengukur **±55–61 fps**. Angka ini indikatif untuk
  mesin uji tersebut; perangkat lain bisa berbeda.
- Semua berjalan di CPU (software canvas). Tidak butuh WebGL atau GPU; kalau
  browser memperlambat canvas, renderer tetap jalan, hanya turun fps.

### Kalau render terasa lambat

1. Perkecil jendela browser (resolusi backing store ikut turun).
2. Pastikan DPR tidak dipaksa > 2 (mis. zoom browser 150% di layar HiDPI); DPR
   memang dibatasi 2, tetapi jendela yang sangat besar tetap memperberat.
3. Tutup tab lain yang berat — renderer software bersaing di CPU.
4. Di mode mabar, tidak perlu menurunkan kualitas: renderer tidak terkait jaringan.

---

## 11. Parameter yang bisa di-tuning

Semua ada di blok script `game.html` (dekat konstanta world/camera). Ubah satu per
satu, lalu cek screenshot (§13).

| Konstanta / nilai | Arti | Efek bila diubah |
|---|---|---|
| `CAM_FOV_DEG = 55` | sudut pandang vertikal (derajat) | lebih besar = lebih "lebar"/fish-eye; lebih kecil = lebih zoom |
| `focal` (turunan FOV) | panjang fokus proyeksi | naik saat FOV turun |
| `CAM_NEAR = 20` | near plane | terlalu kecil = polygon dekat bisa aneh; terlalu besar = objek dekat terpotong |
| `AU = STEP_Y × 0.86` | offset titik bidik | besar = kamera "melihat lebih tinggi" di atas pemain |
| `EYE_ABOVE = 160` | tinggi mata kamera di atas bidang | besar = makin melihat dari atas |
| `dist` (rumus §3.3) | jarak kamera | konstanta `0.33`, `0.46`, clamp `0.5–1.75`, `min 340` mengatur seberapa besar scene tampil |
| `yaw` (`sin(t × 0.00018) × 3°`) | orbit halus | besar = goyangan lebih terasa, kecil = statis |
| `LIGHT_DIR` | arah cahaya (konstanta ternormalisasi) | dipakai `faceBrightness()` untuk sisi miring |
| `faceBrightness` (`0.58 + 0.42 × abs(dot(n, LIGHT_DIR))`) | kontras sisi miring | naikkan `0.42` → kontras lebih tebal |
| faktor shading tetap | kontras muka atas/bawah | platform atas `1.0`, bawah `0.5`; bintang depan `1.0`, belakang `0.62` |
| `ZONE_STEPS = [900, 1800, 2700]` | ambang zona langit | menggeser kapan langit berubah |
| `starAlpha` (1100–2100), `planetAlpha` (2000–2900), `sunset` (900–2500) | rentang fade benda langit | menggeser kapan bintang/bulan/planet/matahari muncul |
| `fog` awan (`1 - (depth - 500)/2400`, min `0.16`) | kabut latar | mengubah kedalaman awan |
| `cloudTint` (`>1100` oranye, `>2200` ungu) | warna awan per zona | mengubah nuansa awan |
| Radius pulau (`max(1200, dist × 2)`) | ukuran pulau | makin jauh kamera, pulau ikut melebar |
| Aerial haze pulau (`(eyeY - 300) / 1900`, maks `0.8`) | kabut pulau | mengubah seberapa cepat pulau memudar |
| Tebal render slab `20` (start `26`), kedalaman `170`, chamfer `0.40` | bentuk platform | mengubah ketebalan/chamfer slab |
| Ukuran awan: latar `620 × scale`, depan `95 × scale` | skala awan | mengubah besar awan relatif scene |
| Posisi benda langit | tata letak langit | bulan `(1700, 3400, -2800)` r175; planet `(-2300, 3300, -3200)` r215; matahari `(-2300, 1450, -3200)` r130 |
| `DPR max 2` | resolusi render | turunkan ke 1.5 untuk mesin lambat |
| `STEP_Y = 210`, `STEP_X` | jarak tangga (gameplay) | **jangan diubah** — memengaruhi gameplay/test |

> `STEP_Y` dan `STEP_X` bukan parameter visual: keduanya menentukan posisi platform
> dan sudah diuji unit test. Ubah hanya kalau memang mengubah gameplay.

---

## 12. Kontrak fungsi dan unit test

Nama fungsi berikut dipakai unit test dan **tidak boleh berubah**:

```
gameTo3D(wx, wy, wz = 0)          -> {x, y, z}
updateCameraRig(t)                 -> menulis global camera3D (t opsional)
projectPoint(p3)                  -> {x, y, depth, scale} | null
projectGamePoint(wx, wy, wz = 0)  -> {x, y, depth, scale} | null
clipPolygonNear(pts3)             -> Array<p3>
drawPoly3(pts3, fill, opts?)      -> void / boolean
shadeHex(hex, k)                  -> 'rgb(r,g,b)'
mixHex(a, b, t)                   -> 'rgb(r,g,b)'
zonePalette(altitudePx)           -> objek zona
platformMesh(p)                   -> {faces: [{pts, kind}], ...}
starMesh()                        -> {faces: [{pts, kind}]}
sortByDepth(items, getDepth)      -> Array
drawSkyAndEnvironment(t)          -> void
drawPlatform(p, isOption)         -> void
drawStarPou(t)                    -> void
animate(t)                        -> void
```

Fungsi internal yang dipakai renderer (tidak wajib dipanggil dari luar):
`viewDepth`, `projectPoly3`, `fillPolyScreen`, `platformRenderWidth`,
`platformTopY`, `buildPlatformMesh`, `drawPlatformPuffs`, `drawPlatformLabel`,
`drawAnswerSign`, `quadBezier3`, `drawJumpGuides`, `drawGroundIsland`,
`drawParticles`, `drawFloatingTexts`, `drawForegroundClouds`, `drawVignette`.

Detail lengkap ada di `tools/3d-engine-spec.md`. Test engine 3D ada di
`tests/game-3d.test.js`; menjalankannya:

```bash
node --test --test-isolation=none tests/game-3d.test.js
node --test --test-isolation=none tests/game-core.test.js
```

---

## 13. Verifikasi visual dengan screenshot

Renderer software tidak bisa diverifikasi hanya dari unit test — perlu screenshot.
Harness `tools/capture3d.mjs` menjalankan Microsoft Edge headless lewat CDP,
membuka game, menjalankan skenario, lalu menyimpan PNG.

### 13.1 Siapkan server statis

```bash
# dari root project — terminal 1
python -m http.server 4173
```

Buka `http://127.0.0.1:4173/game.html` sekali secara manual untuk memastikan halaman
jalan.

### 13.2 Jalankan harness

```bash
# terminal 2
node tools/capture3d.mjs \
  --url=http://127.0.0.1:4173/game.html \
  --out=.shots \
  --viewport=1280x800 \
  --scenario=all
```

Skenario yang tersedia (bisa dipilih dengan `--scenario=nama1,nama2`):

| Skenario | Yang diuji |
|---|---|
| `menu` | Halaman terbuka, menu tampil |
| `solo-start` | Game dimulai, tangga pertama muncul |
| `play` | Dua jawaban benar, kamera naik |
| `wrong` | Jawaban salah, awan pecah & karakter jatuh |
| `mid` | Ketinggian menengah / zona senja (`floorLevel = 11`) |
| `space` | Luar angkasa (`floorLevel = 30`) |
| `climb-history` | Riwayat tangga berundak di bawah pemain (7 tingkat) |
| `mobile-portrait` | Viewport 390×844 |
| `mobile-landscape` | Viewport 844×390 |
| `fps` | Ukur FPS renderer ~1,5 detik setelah satu jawaban benar |

Skenario `fps` mencetak hasil pengukuran (mis. `"result": "61 fps"`) ke
`summary.json`. Pada mesin uji Edge headless tanpa GPU di 1280×800 hasilnya
**±55–61 fps**; perlakukan sebagai angka indikatif, bukan jaminan.

Hasil PNG ada di `FOLDER/<timestamp>/` dari `--out` (default `.shots/`), beserta
`summary.json`. Harness juga mencetak ringkasan JSON: exception dan page error
menggagalkan run (exit code 1); `console.error` hanya dicatat kecuali memakai
`--strict`; `console.warn` selalu hanya dilaporkan. Opsi lain: `--edge=PATH`,
`--settle=MS`, `--port=PORT`, `--keep-open`, `--quiet` (lihat
`tools/README.md`).

### 13.3 Yang perlu dicek di screenshot

- Langit bergradasi sesuai zona, tidak ada pita warna patah.
- Dua platform jawaban **muat** di layar (terutama portrait/sempit).
- Teks `TANGGA n` dan teks jawaban terbaca, tidak terbalik/terpotong.
- Karakter bintang tampak ber-volume (ada sisi gelap/terang dan outline), bukan
  datar.
- Tidak ada garis liar yang menusuk ke tengah layar (gejala near clipping gagal).
- Di `space`: bintang, bulan, dan planet bercincin terlihat; pulau bumi sudah jauh.

---

## 14. Troubleshooting renderer

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| Layar hitam / kosong | Exception saat inisialisasi renderer | Buka DevTools (F12), cek error; jalankan harness untuk melihat exception |
| Platform tampak terbalik / posisi aneh | `cam`/`camera3D` tidak sinkron, `updateCameraRig()` tidak dipanggil | Pastikan `updateCameraRig()` dipanggil tiap frame sebelum gambar |
| Ada segitiga panjang liar | Polygon melewati near plane tanpa clipping | Pastikan `drawPoly3()` memakai `clipPolygonNear()` |
| Objek dekat menutupi objek jauh yang seharusnya di depan | Urutan painter's algorithm salah | Periksa `sortByDepth()`/urutan gambar di `animate()` |
| Render tersendat | Jendela/DPR besar, CPU sibuk | Kecilkan jendela, tutup tab lain, DPR maks 2 |
| Teks jawaban terpotong di HP | Lebar render platform / font tidak mengikuti skala | Cek `min(p.w, STEP_X × 1.7)` dan clamp ukuran font |
| Warna langit "patah" di batas zona | Interpolasi tidak konsisten | Pastikan `top`/`bottom` memakai `lerpColor` seperti versi 2D |

Untuk masalah di luar renderer (WebSocket, admin, deploy), lihat
[09 · Troubleshooting & FAQ](09-troubleshooting-faq.md).

---

Kembali ke [indeks dokumentasi](README.md) · lanjut ke
[08 · Arsitektur & Protokol](08-arsitektur-dan-protokol.md).
