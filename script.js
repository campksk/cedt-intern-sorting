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
        populateWorkingOptions(originalJobList); // 1. เพิ่มบรรทัดนี้
        applyFilterAndSort();

    } catch (error) {
        console.error('Error loading JSON:', error);
        statusMsg.innerHTML = `โหลดข้อมูลไม่สำเร็จ (ต้องเปิดผ่าน Local Server)`;
        statusMsg.className = "text-red-500";
    }
}

// 2. เพิ่มฟังก์ชันนี้ (สำหรับสร้างตัวเลือกใน Dropdown)
function populateWorkingOptions(jobs) {
    const workingSet = new Set();
    jobs.forEach(job => {
        if (job.workingCondition) {
            workingSet.add(job.workingCondition);
        }
    });

    const sortedWorking = Array.from(workingSet).sort();
    const selectElement = document.getElementById('working-filter');

    sortedWorking.forEach(workType => {
        const option = document.createElement('option');
        option.value = workType;
        option.textContent = workType;
        selectElement.appendChild(option);
    });
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

// 3. แก้ไขฟังก์ชันนี้ (เพิ่ม Logic การกรอง)
function applyFilterAndSort() {
    const selectedTag = document.getElementById('tag-filter').value;
    const selectedWorking = document.getElementById('working-filter').value; // รับค่ารูปแบบงาน
    const sortValue = document.getElementById('sort-filter').value;
    const searchText = document.getElementById('search-input').value.trim().toLowerCase();
    const statusMsg = document.getElementById('status-msg');

    let filteredList = originalJobList.filter(job => {
        // เงื่อนไข Tag
        const matchTag = (selectedTag === 'all') || (job.tags && job.tags.some(t => t.tagName === selectedTag));
        
        // เงื่อนไข Search
        const title = (job.title || "").toLowerCase();
        const companyName = (job.company?.companyNameTh || "").toLowerCase();
        const matchSearch = title.includes(searchText) || companyName.includes(searchText);

        // เงื่อนไข Working Condition (เพิ่มใหม่)
        const matchWorking = (selectedWorking === 'all') || (job.workingCondition === selectedWorking);

        return matchTag && matchSearch && matchWorking;
    });

    filteredList.sort((a, b) => {
        const salaryA = a.compensationAmount || 0;
        const salaryB = b.compensationAmount || 0;
        const nameA = a.company?.companyNameTh || '';
        const nameB = b.company?.companyNameTh || '';
        const quotaA = a.quota || 0;
        const quotaB = b.quota || 0;

        switch (sortValue) {
            case 'salary-desc': return salaryB - salaryA;
            case 'salary-asc':  return salaryA - salaryB;
            case 'quota-desc':  return quotaB - quotaA;
            case 'quota-asc':   return quotaA - quotaB;
            case 'name-asc':    return nameA.localeCompare(nameB, 'th'); 
            case 'name-desc':   return nameB.localeCompare(nameA, 'th');
            default: return 0;
        }
    });

    renderJobs(filteredList);

    if (filteredList.length === 0) {
        statusMsg.innerText = "ไม่พบข้อมูลที่ค้นหา";
    } else {
        statusMsg.innerText = `${filteredList.length} ตำแหน่งงาน`;
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
            <div class="col-span-full py-20 text-center">
                <p class="text-gray-400 text-lg font-light">No positions found.</p>
            </div>`;
        return;
    }

    jobs.forEach(job => {
        let compensationHTML = '';
        if (job.compensationAmount && job.compensationAmount > 0) {
            compensationHTML = `<span class="text-lg font-semibold text-gray-900">${formatNumber(job.compensationAmount)}</span> <span class="text-sm text-gray-500 font-light">${job.compensationType?.compensationType}</span>`;
        } else {
            compensationHTML = `<span class="text-gray-400 text-sm font-light">ไม่ระบุเงินเดือน</span>`;
        }

        let tagsHTML = '';
        if (job.tags && job.tags.length > 0) {
            tagsHTML = `<div class="flex flex-wrap gap-2 mt-4">`;
            job.tags.slice(0, 5).forEach(t => { 
                tagsHTML += `<span class="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded hover:bg-gray-200 transition cursor-default">${t.tagName}</span>`;
            });
            tagsHTML += `</div>`;
        }

        let metaList = [];
        if (job.workingCondition) metaList.push(job.workingCondition);
        if (job.quota && job.quota > 0) metaList.push(`รับ ${job.quota} อัตรา`);
        if (job.openForCooperativeInternship) metaList.push(`<span class="text-black font-medium">สหกิจ</span>`);

        const metaHTML = metaList.join(' <span class="text-gray-300 mx-2">•</span> ');

        const cardHTML = `
            <div class="group bg-white p-6 rounded-xl border border-transparent shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] hover:shadow-lg hover:border-gray-100 transition duration-300 flex flex-col h-full">
                
                <div class="mb-4">
                    <h3 class="text-xl font-semibold text-gray-900 leading-snug group-hover:text-blue-600 transition">
                        <a href="https://cedtintern.cp.eng.chula.ac.th/opening/${job.openingId}/session/${job.sessionId}" target="_blank" class="focus:outline-none">
                            ${job.title}
                        </a>
                    </h3>
                    <p class="text-base text-gray-500 mt-1">
                        <a href="https://cedtintern.cp.eng.chula.ac.th/company/profile/${job.company?.companyId}" target="_blank" class="hover:text-gray-800 transition relative z-10">
                            ${job.company?.companyNameTh || 'ไม่ระบุบริษัท'}
                        </a>
                    </p>
                </div>

                <div class="relative z-10">
                    ${tagsHTML}
                </div>

                <div class="mt-auto pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-gray-50 mt-6">
                    <div>
                        ${compensationHTML}
                    </div>
                    <div class="text-sm text-gray-500 font-light flex items-center">
                        ${metaHTML}
                    </div>
                </div>
                
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHTML);
    });
}

loadJSON();