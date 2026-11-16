# CEDT Intern — ตำแหน่งฝึกงาน (v2)

หน้าเว็บค้นหา/กรอง/เรียงตำแหน่งฝึกงาน CEDT ไม่มี build step: หน้าเว็บ static + Vercel Serverless Function 1 ตัว

```
api/jobs.js          รวมข้อมูล → normalize → cache → fallback
lib/upstream.js      ดึงข้อมูลสดจาก API ต้นทาง (วนดึงครบทุกหน้า)
public/              index.html, app.js, style.css
data/semesters.json  รายการรอบที่เก็บถาวร (แก้ไฟล์นี้เพื่อเพิ่ม/ลบรอบ ไม่ต้องแก้โค้ด)
data/<รอบ>.json      ข้อมูลของแต่ละรอบ
scripts/             dev-server.js, snapshot.js, test-api.js, load-env.js
```

## เริ่มใช้งานในเครื่อง (Windows/Mac/Linux)

ต้องมี Node.js 20+

```powershell
copy .env.example .env      # แล้วแก้ .env
npm test                    # ทดสอบ API (ไม่ใช้เน็ต)
npm run dev                 # เปิด http://localhost:3000
```

ไม่มี `UPSTREAM_URL` ก็ใช้ได้ แต่จะมีเฉพาะรอบที่เก็บถาวรใน `data/`

## ตัวเลือกรอบ (semester)

- **Live** — ข้อมูลปัจจุบันจาก API (แสดงเมื่อตั้ง `UPSTREAM_URL` และเป็นค่าเริ่มต้น)
- **รอบอื่น ๆ** — อ่านจาก `data/semesters.json` ซึ่งชี้ไปที่ไฟล์ JSON แต่ละรอบ (เรียงใหม่สุดก่อนในเมนู)

```json
[
  { "id": "2025-1", "label": "2025/1", "file": "2025-1.json" },
  { "id": "2025-2", "label": "2025/2", "file": "2025-2.json", "isDefault": true }
]
```

`isDefault` คือรอบที่ใช้เป็นค่าเริ่มต้นเมื่อไม่มี Live และเป็นรอบที่แสดงแทนเมื่อดึง Live ไม่สำเร็จ
(ถ้าไม่ระบุ ใช้รอบสุดท้ายในไฟล์) รอบที่ไฟล์ข้อมูลหายจะไม่ปรากฏในเมนู

**เก็บรอบที่จบแล้ว** (ดึงครบทุกหน้า เขียนไฟล์ข้อมูล และเพิ่มรายการใน `semesters.json` ให้เอง):

```
node scripts/snapshot.js 2026-1 "2026/1"
```

แล้ว commit `data/` ขึ้น GitHub

## ตั้งค่า API ต้นทาง

ใน `.env` (ในเครื่อง) หรือ Vercel → Settings → Environment Variables (ตอน deploy; Vercel ไม่อ่านไฟล์ `.env`)

| ตัวแปร | ความหมาย |
|---|---|
| `UPSTREAM_URL` | URL ของ API รายการตำแหน่ง ตอบเป็น `{ "items": [...], "meta": {...} }` |
| `UPSTREAM_TOKEN` | (ถ้าต้อง login) ส่งเป็น `Authorization: Bearer …` ใส่เฉพาะส่วนหลัง `Bearer ` |
| `UPSTREAM_COOKIE` | (ถ้า login แบบ cookie) ส่งเป็นหัว `Cookie` ใช้แทน TOKEN |
| `UPSTREAM_PAGE_PARAM` | (ไม่บังคับ) ชื่อพารามิเตอร์เลขหน้า ถ้าตรวจจับเองไม่ได้ |
| `CACHE_TTL_SEC` | (ไม่บังคับ) อายุแคชของ Live ค่าเริ่มต้น 3600 วินาที |

หา URL/token: เปิดเว็บ CEDT ตอน login → F12 → Network → Fetch/XHR → เลือก request ที่ตอบ JSON มี `items`
→ ดู Request URL และ Request Headers (`Authorization` หรือ `Cookie`)

### Pagination

API คืนทีละ 100 รายการ ระบบจะอ่าน `meta.totalItem/totalPage` แล้วดึงหน้าที่เหลือให้ครบเอง
โดยลองชื่อพารามิเตอร์ `page`, `currentPage`, `pageNo`, `pageNumber` ตามลำดับ ถ้าดึงไม่ครบจะ **ไม่แสดงข้อมูลไม่ครบ**
แต่ถือว่าล้มเหลวและแสดงสาเหตุ (ป้องกันการจัดอันดับจากข้อมูลที่ขาด)

ถ้า API รองรับ ใส่พารามิเตอร์ขนาดหน้าใน URL จะได้ครบในคำขอเดียว เช่น
`UPSTREAM_URL=https://…/openings?limit=1000` (ถ้า URL มี `?` อยู่แล้วให้ต่อด้วย `&limit=1000`)
ชื่อพารามิเตอร์ที่ถูกต้องดูได้จาก Network tab ของเว็บต้นทาง

## การ cache

1. หน่วยความจำของ function (TTL ตาม `CACHE_TTL_SEC`)
2. Vercel CDN — Live: `s-maxage=TTL`; รอบเก็บถาวร: 1 วัน; ผลที่ fallback/stale: 2 นาที (ลองใหม่เร็ว)
3. localStorage ของผู้ใช้ — เปิดครั้งถัดไปเห็นข้อมูลทันที แล้วตรวจข้อมูลใหม่เงียบ ๆ

ถ้าดึง Live ไม่สำเร็จ: ใช้ข้อมูลล่าสุดที่เคยดึงได้ → ไม่มีก็แสดงรอบเก็บถาวรเริ่มต้น และบอกสาเหตุที่หัวหน้าเว็บ
(เช่น `upstream HTTP 401 — likely needs login…`) ส่วนในเบราว์เซอร์ ถ้ามีข้อมูล Live ที่แคชไว้ จะไม่ถูกทับด้วยข้อมูลเก็บถาวร

## Deploy บน Vercel

push ขึ้น GitHub → vercel.com → Add New Project → Framework Preset: **Other** → ตั้ง Environment Variables → Deploy
(ห้าม commit `.env`; token/cookie ที่ได้จากการ login มักหมดอายุ ถ้าไม่อยากดูแล ให้รัน `snapshot.js` เองเป็นระยะแล้ว commit)

## ข้อควรรู้

- **ค่าตอบแทนเรียงเป็นต่อวัน**: บาท/เดือน ÷ 22 วันทำการ เหมาจ่าย/ไม่ระบุหน่วยเทียบไม่ได้จึงอยู่ท้ายเสมอ
- **"คนสนใจ/คนแย่ง"** มาจาก `inStudentDraftCount` ÷ จำนวนรับ (ตีความจากชื่อฟิลด์) ใช้เป็นตัวชี้นำคร่าว ๆ
- "ใหม่ล่าสุด" เรียงตาม `openingId`
- ข้อมูลถูกแปลงเป็นข้อความล้วนก่อนแสดงผล (กัน HTML/สคริปต์แปลกปลอมจากต้นทาง)
