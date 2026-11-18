# เว็บแยกโฮสต์ + Raspberry Pi เป็นเซิร์ฟเวอร์ข้อมูล

```
[ผู้ใช้] ──► เว็บ static (โฮสต์ที่คุณเลือก, ชื่อสวย ๆ)
                 │  เบราว์เซอร์ดึงข้อมูลจาก
                 ▼
            Raspberry Pi  ◄── login + ดึงข้อมูล + โหลดโลโก้ ทุก 6 ชั่วโมง (ใน background)
            (/api/jobs, /logos/*)   รหัสผ่านและคุกกี้อยู่ที่นี่เครื่องเดียว
```

- ผู้ใช้เปิดเว็บ → ได้ไฟล์ static จากโฮสต์ → เบราว์เซอร์ดึง `/api/jobs` และรูปโลโก้จาก Pi
- Pi **ไม่ login และไม่เรียก upstream ตอนมีคนเข้าเว็บ** ทุกอย่างทำใน background ตามรอบ (`REFRESH_HOURS`, ค่าเริ่มต้น 6)
- Pi เปิดแค่ 3 เส้นทาง: `GET /api/jobs`, `GET /logos/<ไฟล์>` และ `/healthz` ไม่มี `/api/logo` (ไม่มีช่อง SSRF)
- ชื่อที่ดูไม่สวย (เช่น `*.ts.net`) จะมีแค่ฝั่ง API ผู้ใช้เห็นแต่ชื่อเว็บของคุณ

## 1. เตรียมโค้ดบน Pi (ตัวอย่างใช้ user `camp`, โฟลเดอร์ `~/cedt-intern-sorting`)
```bash
sudo apt update && sudo apt install -y chromium     # ถ้าไม่พบ ให้ลอง chromium-browser
cd ~/cedt-intern-sorting
git stash -u                         # เก็บการแก้เดิมที่ทำไว้บน Pi (ถ้ามี) ไม่ลบทิ้ง
git pull                             # ให้ตรงกับ main
git apply /path/to/pi-publisher.patch
npm ci --omit=dev --ignore-scripts
```

## 2. ตั้งค่า `.env`
```bash
nano .env      # หรือ cp .env.example .env ถ้ายังไม่มี
chmod 600 .env
```
ค่าที่ต้องมี:
```
UPSTREAM_URL=...            # เหมือนเดิม
MCV_USERNAME=...
MCV_PASSWORD=...
CHROMIUM_PATH=/usr/bin/chromium    # ผลของ: which chromium
WEB_ORIGINS=                       # เติมทีหลังเมื่อรู้ชื่อเว็บแล้ว (ข้อ 5)
REFRESH_HOURS=6
```

## 3. ทดสอบการ login และดึงข้อมูล (ยังไม่ต้องเปิดเซิร์ฟเวอร์)
```bash
npm run pi:refresh        # ครั้งแรกอาจนาน 30-90 วินาที (Chromium login แล้วโหลดโลโก้)
ls data-live data-live/logos | head
```
ต้องเห็นบรรทัด `[publisher] N items; logos: ...` และมีไฟล์ `data-live/live.json`
ถ้า login ไม่ผ่าน ดูหัวข้อ "แก้ปัญหา" ด้านล่าง

## 4. รันเป็นบริการ
```bash
sudo cp deploy/cedt-pi-api.service /etc/systemd/system/
sudo nano /etc/systemd/system/cedt-pi-api.service      # เช็ก User / path ให้ตรง
sudo systemctl daemon-reload
sudo systemctl enable --now cedt-pi-api
sudo systemctl status cedt-pi-api --no-pager
curl -s localhost:3000/healthz            # ได้ {"ok":true,"liveAt":"..."}
curl -s localhost:3000/api/jobs | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['semester'],d['source'],d['count'])"
```
(ถ้าเคยติดตั้ง `cedt-intern.service` ของชุดก่อนหน้า ให้ `sudo systemctl disable --now cedt-intern` ก่อน เพราะใช้พอร์ต 3000 เหมือนกัน)

## 5. เปิดให้เว็บเข้าถึง Pi (เลือกอย่างใดอย่างหนึ่ง)
- **Tailscale Funnel** (คุณใช้ Tailscale อยู่แล้ว): `sudo tailscale funnel --bg 3000` แล้วดู URL ด้วย `tailscale funnel status`
  (ต้องเปิด MagicDNS/HTTPS และมี node attribute `funnel` ใน policy ตามที่คำสั่งแจ้ง ผมยังไม่ได้ตรวจเงื่อนไขล่าสุดจากหน้าทางการของ Tailscale)
- **Cloudflare Tunnel**: ดู `deploy/README.md` ของชุดก่อนหน้า (ถ้าไม่มีโดเมน ใช้ quick tunnel ได้แต่ URL เปลี่ยนทุกครั้ง)

ได้ URL แบบ `https://xxxx.ts.net` แล้วให้จดไว้ ใช้ในข้อ 6

## 6. สร้างและ deploy เว็บ
บนเครื่องที่มีโค้ด (Pi หรือคอมของคุณก็ได้):
```bash
PI_URL=https://xxxx.ts.net npm run build:static
```
ได้โฟลเดอร์ `dist/` ซึ่งมี `config.js` ที่ชี้ไป Pi และไฟล์ header ความปลอดภัยสำหรับโฮสต์ (`_headers` สำหรับ Cloudflare Pages/Netlify, `vercel.json` สำหรับ Vercel)
นำ `dist/` ไป deploy ที่โฮสต์ static ที่คุณเลือก (แนะนำให้อ่านเงื่อนไขแผนฟรีของแต่ละเจ้าก่อน)

## 7. อนุญาตชื่อเว็บใน CORS (สำคัญ ถ้าข้ามขั้นนี้เว็บจะโหลดข้อมูลไม่ได้)
เมื่อได้ชื่อเว็บแล้ว (เช่น `https://ชื่อ.pages.dev`) ใส่ใน `.env` บน Pi **เป็น origin ตรง ๆ ไม่มี / ท้าย** (ใส่หลายชื่อได้โดยคั่นด้วย `,`):
```
WEB_ORIGINS=https://ชื่อ.pages.dev
```
แล้ว `sudo systemctl restart cedt-pi-api` จากนั้นเปิดเว็บและกด F12 → Network ดู request `api/jobs` ต้องเป็นสถานะ 200

## พฤติกรรมที่ควรรู้
- ถ้า Pi ดับหรือเน็ตบ้านหลุด เว็บจะดึงข้อมูลไม่ได้ ผู้ที่เคยเปิดเว็บแล้วจะเห็นข้อมูลแคชในเบราว์เซอร์ (สูงสุด 7 วัน) แต่ผู้เข้าใหม่จะไม่เห็นข้อมูล
- ถ้ารอบ refresh ล้มเหลว Pi จะเก็บข้อมูลชุดเดิมไว้และลองใหม่ทุก 30 นาที ถ้าข้อมูลเก่าเกิน 24 ชั่วโมง (`STALE_HOURS`) หน้าเว็บจะแจ้งว่าข้อมูลอาจไม่ใช่ล่าสุด
- semester เก่า (archive) ก็ให้บริการจาก Pi เช่นกัน และโลโก้ของ archive จะถูกโหลดเก็บไว้ในรอบ refresh ครั้งแรก
- ข้อมูลรวมถึงอีเมล/เบอร์ติดต่อของบริษัทยังเปิดให้ทุกคนอ่านได้เหมือนเดิม ถ้าไม่ต้องการ ให้บอกผมเพื่อตัดฟิลด์ติดต่อออก
- rate limit: `/api/jobs` 120 ครั้ง/นาที/IP และโลโก้ 600 ครั้ง/นาที/IP (ผ่าน Funnel ต้องตรวจว่า IP ผู้ใช้ถูกส่งมาใน `X-Forwarded-For` จริง ถ้าไม่ ทุกคนจะถูกนับเป็นคนเดียว)

## แก้ปัญหา
- `browserType.launch: ... not found` → ยังไม่ได้ตั้ง `CHROMIUM_PATH` หรือ path ผิด (`which chromium`)
- `auto-login is cooling down` → login ล้มเหลวไปแล้ว ระบบพัก 5 นาทีเพื่อไม่ให้บัญชีถูกล็อก รอหรือ `sudo systemctl restart cedt-pi-api`
- เว็บขึ้นแต่ไม่มีข้อมูล, Console มี `CORS` → `WEB_ORIGINS` ไม่ตรงกับชื่อเว็บ (ต้องตรงทุกตัวอักษร รวม `https://`)
- ดู log: `journalctl -u cedt-pi-api -n 50 --no-pager` (อย่าวางรหัสผ่านหรือคุกกี้ลงในแชทหรือที่สาธารณะ)
