let originalJobList = []; 

async function loadJSON() {
    const statusMsg = document.getElementById('status-msg');
    try {
        const response = await fetch('result.json'); 
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        if (data.items) {
            originalJobList = data.items;
        } else if (Array.isArray(data)) {
            originalJobList = data;
        } else {
            originalJobList = data.fullContent ? data.fullContent.items : [];
        }

        populateTagOptions(originalJobList);
        applyFilterAndSort();

    } catch (error) {
        console.error('Error loading JSON:', error);
        statusMsg.innerHTML = `<span class="text-red-500 font-bold">โหลดไฟล์ไม่ได้!</span> (ต้องเปิดผ่าน Local Server)`;
    }
}

function populateTagOptions(jobs) {
    const tagSet = new Set();
    jobs.forEach(job => {
        if (job.tags && Array.isArray(job.tags)) {
            job.tags.forEach(tag => {
                if(tag.tagName) tagSet.add(tag.tagName);
            });
        }
    });

    const sortedTags = Array.from(tagSet).sort();
    const selectElement = document.getElementById('tag-filter');

    sortedTags.forEach(tagName => {
        const option = document.createElement('option');
        option.value = tagName;
        option.textContent = tagName;
        selectElement.appendChild(option);
    });
}

// *** ฟังก์ชันหลักที่แก้ไขใหม่ (เพิ่ม Search Logic) ***
function applyFilterAndSort() {
    const selectedTag = document.getElementById('tag-filter').value;
    const sortValue = document.getElementById('sort-filter').value;
    // รับค่าจากช่องค้นหา และแปลงเป็นตัวเล็กทั้งหมด (Case Insensitive)
    const searchText = document.getElementById('search-input').value.trim().toLowerCase();
    const statusMsg = document.getElementById('status-msg');

    // 1. Filter ข้อมูล (ทั้ง Tag และ Search Text)
    let filteredList = originalJobList.filter(job => {
        // เงื่อนไข Tag
        const matchTag = (selectedTag === 'all') || (job.tags && job.tags.some(t => t.tagName === selectedTag));
        
        // เงื่อนไข Search (ค้นหาจากชื่อตำแหน่ง หรือ ชื่อบริษัท)
        const title = (job.title || "").toLowerCase();
        const companyName = (job.company?.companyNameTh || "").toLowerCase();
        const matchSearch = title.includes(searchText) || companyName.includes(searchText);

        return matchTag && matchSearch;
    });

    // 2. Sort ข้อมูล
    filteredList.sort((a, b) => {
        const salaryA = a.compensationAmount || 0;
        const salaryB = b.compensationAmount || 0;
        const nameA = a.company?.companyNameTh || '';
        const nameB = b.company?.companyNameTh || '';

        switch (sortValue) {
            case 'salary-desc': return salaryB - salaryA;
            case 'salary-asc':  return salaryA - salaryB;
            case 'name-asc':    return nameA.localeCompare(nameB, 'th'); 
            case 'name-desc':   return nameB.localeCompare(nameA, 'th');
            default: return 0;
        }
    });

    // 3. Render
    renderJobs(filteredList);

    // อัปเดตข้อความสถานะ
    statusMsg.innerText = `แสดงผล ${filteredList.length} จาก ${originalJobList.length} รายการ`;
    
    // ถ้าไม่เจอข้อมูล ให้เปลี่ยนสีข้อความ
    if (filteredList.length === 0) {
        statusMsg.className = "text-red-500 text-sm mt-1";
        statusMsg.innerText += " (ไม่พบข้อมูลที่ค้นหา)";
    } else {
        statusMsg.className = "text-green-600 text-sm mt-1";
    }
}

function formatNumber(num) {
    return num ? num.toLocaleString() : '0';
}

function renderJobs(jobs) {
    const container = document.getElementById('job-container');
    container.innerHTML = ''; 

    if (jobs.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-12 flex flex-col items-center justify-center text-center bg-white rounded-xl border border-dashed border-gray-300">
                <svg class="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <p class="text-gray-500 text-lg font-medium">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</p>
                <p class="text-gray-400 text-sm">ลองเปลี่ยนคำค้นหา หรือเปลี่ยนตัวกรอง Tags</p>
            </div>`;
        return;
    }

    jobs.forEach(job => {
        const logo = job.company?.logoUrl || 'https://via.placeholder.com/100?text=No+Logo';
        let compensationText = '';
        let compensationClass = '';
        
        if (job.compensationAmount && job.compensationAmount > 0) {
            compensationText = `${formatNumber(job.compensationAmount)} <span class="text-xs font-normal text-gray-500">${job.compensationType?.compensationType || ''}</span>`;
            compensationClass = 'text-green-600';
        } else {
            compensationText = 'ไม่ระบุ';
            compensationClass = 'text-gray-400 text-lg';
        }

        let tagsHTML = '';
        if (job.tags && job.tags.length > 0) {
            tagsHTML = `<div class="mt-3 flex flex-wrap gap-1.5 pt-3 border-t border-gray-50">`;
            job.tags.slice(0, 10).forEach(t => {
                tagsHTML += `<span class="px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded-md border border-gray-200 truncate max-w-[150px]">${t.tagName}</span>`;
            });
            if (job.tags.length > 10) {
                tagsHTML += `<span class="px-2 py-0.5 bg-gray-50 text-gray-400 text-[10px] rounded-md">+${job.tags.length - 10}</span>`;
            }
            tagsHTML += `</div>`;
        }

        let quotaHTML = '';
        if (job.quota && job.quota > 0) {
            quotaHTML = `
                <span class="px-2 py-0.5 bg-orange-50 text-orange-700 text-[10px] rounded-md font-medium border border-orange-100 flex items-center gap-1 whitespace-nowrap">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    รับ ${job.quota}
                </span>
            `;
        }

        const cardHTML = `
            <div class="card bg-white rounded-xl shadow-sm hover:shadow-md overflow-hidden border border-gray-200 p-5 flex flex-col h-full relative">
                <div class="flex items-start gap-4 mb-2">
                    <img src="${logo}" alt="${job.company?.companyNameTh}" class="w-14 h-14 object-contain rounded-lg border border-gray-100 bg-white flex-shrink-0">
                    <div class="min-w-0">
                        <h3 class="font-bold text-base text-gray-800 leading-snug mb-1 line-clamp-2 hover:text-blue-600 transition">
                            <a href="https://cedtintern.cp.eng.chula.ac.th/opening/${job.openingId}/session/${job.sessionId}" target="_blank">${job.title}</a>
                        </h3>
                        <p class="text-xs text-gray-500 line-clamp-1 hover:underline">
                            <a href="https://cedtintern.cp.eng.chula.ac.th/company/profile/${job.company?.companyId}" target="_blank">${job.company?.companyNameTh || 'ไม่ระบุบริษัท'}</a>
                        </p>
                    </div>
                </div>
                ${tagsHTML}
                
                <div class="mt-auto pt-4 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                    <div>
                        <div class="text-xl font-bold ${compensationClass}">${compensationText}</div>
                    </div>
                    
                    <div class="flex flex-wrap items-center justify-start sm:justify-end gap-2">
                        ${quotaHTML}
                        
                        ${job.openForCooperativeInternship ? 
                            '<span class="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] rounded-full font-bold border border-purple-200 whitespace-nowrap">สหกิจ</span>' : ''}
                        
                        <span class="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded-md font-medium border border-blue-100 whitespace-nowrap">
                            ${job.workingCondition || 'ไม่ระบุ'}
                        </span>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHTML);
    });
}

loadJSON();