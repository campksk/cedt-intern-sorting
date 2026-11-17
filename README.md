# รันบน Raspberry Pi + Cloudflare Tunnel

ภาพรวม: Pi รัน `scripts/server.js` ที่ `127.0.0.1:3000` (ไม่เปิดพอร์ตออกอินเทอร์เน็ต)
แล้วให้ `cloudflared` เชื่อมต่อออกไปหา Cloudflare เพื่อเปิดเว็บให้คนทั่วไปเข้าผ่านโดเมนของคุณ

## 0. สิ่งที่ต้องมี
- Raspberry Pi 4/5 (RAM ≥ 2 GB) ลง Raspberry Pi OS **64-bit** (เช็กด้วย `uname -m` ต้องได้ `aarch64`)
- บัญชี Cloudflare (ฟรี) และโดเมนที่ใช้ DNS ของ Cloudflare ถ้าอยากได้ URL ถาวร
  (ไม่มีโดเมน: ใช้ quick tunnel ในข้อ 7 ได้ แต่ URL จะสุ่มและเปลี่ยนทุกครั้ง)

## 1. ติดตั้งโปรแกรม
```bash
sudo apt update && sudo apt install -y git chromium
# Node.js 22 (Debian bookworm มี Node 18 ซึ่งเก่าเกินไป: โปรเจกต์ต้องการ >= 20)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```
ถ้า `chromium` ไม่พบแพ็กเกจ ให้ลอง `chromium-browser` แล้วแก้ `CHROMIUM_PATH` ให้ตรง (`which chromium chromium-browser`)

## 2. ดึงโค้ด + ติดตั้ง
```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin cedt
sudo mkdir -p /opt/cedt-intern && sudo chown cedt:cedt /opt/cedt-intern
sudo -u cedt git clone https://github.com/campksk/cedt-intern-sorting.git /opt/cedt-intern
cd /opt/cedt-intern
# apply patch สำหรับ Pi (patch ความปลอดภัยอยู่ใน main แล้ว ไม่ต้อง apply ซ้ำ)
# หรือจะ commit patch นี้ขึ้น GitHub ก่อนแล้วค่อย git pull ก็ได้
sudo -u cedt git apply /path/to/pi-selfhost.patch
sudo -u cedt npm ci --omit=dev --ignore-scripts
```

## 3. ตั้งค่า `.env`
```bash
sudo -u cedt cp .env.example .env
sudo -u cedt nano .env      # ใส่ UPSTREAM_URL, MCV_USERNAME, MCV_PASSWORD
sudo chmod 600 /opt/cedt-intern/.env
```
แนะนำให้ตั้ง `CACHE_TTL_SEC=21600` (6 ชั่วโมง) เพื่อให้ดึงข้อมูลสดน้อยลง
และควรใช้บัญชีที่สิทธิ์ต่ำที่สุดเท่าที่ทำได้ เพราะรหัสผ่านจะเก็บอยู่บน Pi เครื่องนี้

## 4. ทดสอบก่อน
```bash
sudo -u cedt env CHROMIUM_PATH=/usr/bin/chromium node scripts/server.js
# เปิดอีก terminal
curl localhost:3000/healthz            # ต้องได้ ok
curl -s localhost:3000/api/jobs | head -c 300   # ครั้งแรกจะ login ด้วย Chromium อาจใช้ 30-60 วินาทีบน Pi
```
ถ้า login ไม่ผ่าน ดู log ในหน้าจอที่รัน server

## 5. รันเป็นบริการ (เปิดเองเมื่อบูต)
```bash
sudo cp deploy/cedt-intern.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cedt-intern
sudo systemctl status cedt-intern
journalctl -u cedt-intern -f           # ดู log
```

## 6. Cloudflare Tunnel (URL ถาวร)
ติดตั้ง `cloudflared`:
```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install cloudflared
```
จากนั้นที่ Cloudflare Dashboard ไปที่ **Networking → Tunnels → Create Tunnel** (ชื่อเมนูอาจเปลี่ยนได้)
1. ตั้งชื่อ (เช่น `pi-cedt`) เลือก Linux และสถาปัตยกรรม `arm64`
2. คัดลอกคำสั่ง `sudo cloudflared service install <token>` ไปรันบน Pi
   (token คือความลับ ห้ามแชร์หรือ commit)
3. เพิ่ม **Public hostname**: เลือกโดเมน/ซับโดเมน แล้วตั้ง Service เป็น `HTTP` → `localhost:3000`

## 7. ไม่มีโดเมน: quick tunnel (ชั่วคราว)
```bash
cloudflared tunnel --url http://localhost:3000
```
จะได้ URL แบบ `https://xxxx.trycloudflare.com` ที่เปลี่ยนทุกครั้งที่รันใหม่ เหมาะกับทดลองเท่านั้น

## 8. ตั้งค่าป้องกันที่ Cloudflare (แนะนำ)
- WAF → Rate limiting rules: จำกัด `/api/*` (เช่น 60 ครั้ง/นาที/IP) ตัวเว็บเองมี rate limit อยู่แล้ว
  แต่ปล่อยให้ Cloudflare กันก่อนถึง Pi จะดีกว่า
- เปิด Bot Fight Mode และ SSL/TLS = Full, เปิด "Always Use HTTPS"
- (ไม่บังคับ) Cache Rule สำหรับ `/api/logo*` ให้ cache ตาม origin เพื่อลดงานของ Pi

## 9. ความปลอดภัยของ Pi
- SSH ใช้ key เท่านั้น ปิด password login และอย่าทำ port forwarding บนเราเตอร์ (ไม่จำเป็น)
- เปิด `unattended-upgrades` และอัปเดต `cloudflared` กับ Chromium เป็นระยะ
- ทุกอย่างเข้าถึงเว็บได้ผ่าน Cloudflare เท่านั้น (server ฟังเฉพาะ 127.0.0.1)
- ถ้าสงสัยว่า Pi ถูกเจาะ: เปลี่ยนรหัสผ่าน MCV และ revoke tunnel token ที่ Cloudflare ทันที

## 10. เลิกใช้ Vercel
ลบ Environment Variables ใน Vercel (โดยเฉพาะรหัสผ่านและคุกกี้) และปิดหรือลบโปรเจกต์ เพื่อไม่ให้มี function ทำงานเพิ่ม
แล้วชี้โดเมนมาที่ tunnel แทน

## คำสั่งที่ใช้บ่อย
```bash
sudo systemctl restart cedt-intern        # รีสตาร์ตแอป
sudo -u cedt git -C /opt/cedt-intern pull && sudo -u cedt npm ci --omit=dev --ignore-scripts && sudo systemctl restart cedt-intern   # อัปเดต
```
