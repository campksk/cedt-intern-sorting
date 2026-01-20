// --- Configuration ---
let companiesData = [];
let currentSort = { key: 'companyNameTh', order: 'asc' };

const tableBody = document.getElementById('tableBody');
const searchInput = document.getElementById('searchInput');
const resultCount = document.getElementById('resultCount');

// --- 1. Load Data ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // ดึงข้อมูลจากไฟล์ company.json
        const res = await fetch('company.json');
        
        if (!res.ok) throw new Error(`File not found (${res.status})`);
        
        const data = await res.json();
        const rawItems = data.items || [];
        
        // แปลงข้อมูลให้อยู่ในรูปแบบที่จัดการง่าย (Flatten Data)
        companiesData = rawItems.map(c => ({
            ...c,
            type: c.companyType?.type || 'N/A',
            province: c.province || 'Bangkok' // Default ค่าจังหวัด
        }));

        renderTable(companiesData);
        searchInput.disabled = false;
        resultCount.textContent = `${companiesData.length} Companies`;

    } catch (err) {
        console.error(err);
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="state-msg error">
                    Error loading data: ${err.message}<br>
                    <small>Please ensure you are running this on a local server (e.g., Live Server)</small>
                </td>
            </tr>`;
        resultCount.textContent = 'Error';
    }
});

// --- 2. Render Table Function ---
function renderTable(data) {
    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="state-msg">No results found.</td></tr>`;
        return;
    }

    let html = '';
    data.forEach(item => {
        // จัดการ Link (ถ้าไม่มีให้ทำเป็นตัวจาง)
        const webLink = item.website 
            ? `<a href="${item.website}" target="_blank">Web</a>` 
            : `<a class="disabled">Web</a>`;
            
        const fbLink = item.facebook 
            ? `<a href="${item.facebook}" target="_blank">FB</a>` 
            : `<a class="disabled">FB</a>`;
            
        const lineLink = item.line 
            ? `<a href="#" onclick="alert('Line ID: ${item.line}');return false;">Line</a>` 
            : `<a class="disabled">Line</a>`;

        // สร้างแถวตาราง
        html += `
            <tr>
                <td class="col-name">
                    <span class="name-th">${item.companyNameTh || '-'}</span>
                    <span class="name-en">${item.companyNameEn || ''}</span>
                </td>
                <td><span class="badge badge-type">${item.type}</span></td>
                <td><span class="badge badge-loc">${item.province}</span></td>
                <td class="action-links">
                    ${webLink}
                    ${fbLink}
                    ${lineLink}
                </td>
            </tr>
        `;
    });
    tableBody.innerHTML = html;
    resultCount.textContent = `${data.length} Results`;
}

// --- 3. Search Logic ---
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    
    // กรองข้อมูล
    const filtered = companiesData.filter(c => {
        return (c.companyNameTh || '').toLowerCase().includes(term) ||
               (c.companyNameEn || '').toLowerCase().includes(term) ||
               c.type.toLowerCase().includes(term) ||
               c.province.toLowerCase().includes(term);
    });

    // เรียงลำดับข้อมูลที่กรองแล้วตามสถานะ Sort ปัจจุบัน
    sortData(filtered, currentSort.key, currentSort.order);
});

// --- 4. Sorting Logic ---
// ฟังก์ชันนี้จะถูกเรียกจาก HTML (onclick)
window.sortTable = (key) => {
    // สลับทิศทาง (Ascending <-> Descending)
    if (currentSort.key === key) {
        currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.key = key;
        currentSort.order = 'asc';
    }

    // ดึงข้อมูลชุดปัจจุบัน (เผื่อกำลังค้นหาอยู่)
    const term = searchInput.value.toLowerCase().trim();
    let currentList = companiesData.filter(c => {
        return (c.companyNameTh || '').toLowerCase().includes(term) ||
               (c.companyNameEn || '').toLowerCase().includes(term) ||
               c.type.toLowerCase().includes(term) ||
               c.province.toLowerCase().includes(term);
    });

    sortData(currentList, currentSort.key, currentSort.order);
    updateHeaderIcons(key, currentSort.order);
};

function sortData(list, key, order) {
    list.sort((a, b) => {
        let valA = (a[key] || '').toString().toLowerCase();
        let valB = (b[key] || '').toString().toLowerCase();

        if (valA < valB) return order === 'asc' ? -1 : 1;
        if (valA > valB) return order === 'asc' ? 1 : -1;
        return 0;
    });
    renderTable(list);
}

function updateHeaderIcons(activeKey, order) {
    // รีเซ็ตไอคอนทั้งหมดเป็น ⇅
    document.querySelectorAll('th span').forEach(s => s.textContent = '⇅');
    
    // เปลี่ยนไอคอนตัวที่ถูกคลิก
    const activeHeader = document.querySelector(`th[onclick="sortTable('${activeKey}')"] span`);
    if(activeHeader) {
        activeHeader.textContent = order === 'asc' ? '↑' : '↓';
    }
}