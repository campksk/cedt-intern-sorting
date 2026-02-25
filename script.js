let originalJobList = [];

async function initApp() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) throw new Error('ไม่พบไฟล์สารบัญ config.json');
        const fileList = await response.json();

        const selectElement = document.getElementById('data-source-select');
        selectElement.innerHTML = ''; 

        let defaultFile = fileList[0].filename; 

        fileList.forEach(file => {
            const option = document.createElement('option');
            option.value = file.filename;
            option.textContent = file.label;
            
            if (file.isDefault) {
                option.selected = true;
                defaultFile = file.filename;
            }
            
            selectElement.appendChild(option);
        });

        loadJSON(defaultFile);

    } catch (error) {
        console.error("Error init:", error);
        document.getElementById('status-msg').innerHTML = 'ไม่สามารถโหลดระบบได้ กรุณาตรวจสอบไฟล์ data/config.json';
        document.getElementById('status-msg').className = "text-red-500";
    }
}

async function loadJSON(fileName) {
    const statusMsg = document.getElementById('status-msg');
    statusMsg.innerHTML = 'กำลังโหลดข้อมูล...'; 
    statusMsg.className = "text-sm md:text-base text-gray-500 font-light";

    try {
        const response = await fetch(`data/${fileName}`); 
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        // ดึงข้อมูล array มาเก็บไว้ใน originalJobList
        if (data.items) {
            originalJobList = data.items;
        } else if (Array.isArray(data)) {
            originalJobList = data;
        } else {
            originalJobList = data.fullContent ? data.fullContent.items : [];
        }

        originalJobList = originalJobList.filter(job => job.quota && job.quota > 0 && job.isAcceptingApplication);

        populateTagOptions(originalJobList);
        populateWorkingOptions(originalJobList);
        applyFilterAndSort();
        
        // statusMsg.innerHTML = `โหลดข้อมูลจาก ${fileName} สำเร็จ`;
    } catch (error) {
        console.error("Error loading JSON:", error);
        statusMsg.innerHTML = `โหลดข้อมูล ${fileName} ไม่สำเร็จ`;
        statusMsg.className = "text-red-500";
    }
}

function changeDataSource() {
    const selectedFile = document.getElementById('data-source-select').value;
    document.getElementById("search-input").value = "";
    document.getElementById("tag-filter").value = "all";
    document.getElementById("working-filter").value = "all";
    loadJSON(selectedFile);
}

function populateWorkingOptions(jobs) {
  const workingSet = new Set();
  jobs.forEach((job) => {
    if (job.workingCondition) {
      workingSet.add(job.workingCondition);
    }
  });

  const sortedWorking = Array.from(workingSet).sort();
  const selectElement = document.getElementById("working-filter");

  selectElement.innerHTML = '<option value="all">รูปแบบงานทั้งหมด</option>';

  sortedWorking.forEach((workType) => {
    const option = document.createElement("option");
    option.value = workType;
    option.textContent = workType;
    selectElement.appendChild(option);
  });
}

function populateTagOptions(jobs) {
  const tagSet = new Set();
  jobs.forEach((job) => {
    if (job.tags && Array.isArray(job.tags)) {
      job.tags.forEach((tag) => {
        if (tag.tagName) tagSet.add(tag.tagName);
      });
    }
  });

  const sortedTags = Array.from(tagSet).sort();
  const selectElement = document.getElementById("tag-filter");

  selectElement.innerHTML = '<option value="all">Tags ทั้งหมด</option>';

  sortedTags.forEach((tagName) => {
    const option = document.createElement("option");
    option.value = tagName;
    
    const maxLength = 40;
    if (tagName.length > maxLength) {
        option.textContent = tagName.substring(0, maxLength) + '...';
    } else {
        option.textContent = tagName;
    }

    selectElement.appendChild(option);
  });
}

function applyFilterAndSort() {
  const selectedTag = document.getElementById("tag-filter").value;
  const selectedWorking = document.getElementById("working-filter").value;
  const sortValue = document.getElementById("sort-filter").value;
  const searchText = document
    .getElementById("search-input")
    .value.trim()
    .toLowerCase();
  const statusMsg = document.getElementById("status-msg");
  
  // ป้องกัน error ถ้า Dropdown ยังไม่โหลด
  const dataSourceSelect = document.getElementById('data-source-select');
  const currentFile = dataSourceSelect ? dataSourceSelect.value : ""; 

  let filteredList = originalJobList.filter((job) => {
    const matchTag =
      selectedTag === "all" ||
      (job.tags && job.tags.some((t) => t.tagName === selectedTag));

    const title = (job.title || "").toLowerCase();
    const companyName = (job.company?.companyNameTh || "").toLowerCase();
    const matchSearch =
      title.includes(searchText) || companyName.includes(searchText);

    const matchWorking =
      selectedWorking === "all" || job.workingCondition === selectedWorking;

    return matchTag && matchSearch && matchWorking;
  });

  filteredList.sort((a, b) => {
    const salaryA = a.compensationAmount || 0;
    const salaryB = b.compensationAmount || 0;
    const nameA = a.company?.companyNameTh || "";
    const nameB = b.company?.companyNameTh || "";
    const quotaA = a.quota || 0;
    const quotaB = b.quota || 0;

    switch (sortValue) {
      case "salary-desc":
        return salaryB - salaryA;
      case "salary-asc":
        return salaryA - salaryB;
      case "quota-desc":
        return quotaB - quotaA;
      case "quota-asc":
        return quotaA - quotaB;
      case "name-asc":
        return nameA.localeCompare(nameB, "th");
      case "name-desc":
        return nameB.localeCompare(nameA, "th");
      default:
        return 0;
    }
  });

  renderJobs(filteredList);

  if (filteredList.length === 0) {
    statusMsg.innerText = "ไม่พบข้อมูลที่ค้นหา";
  } else {
    statusMsg.innerText = `แสดงผล ${filteredList.length} ตำแหน่งงาน`;
  }
}

function formatNumber(num) {
  return num ? num.toLocaleString() : "0";
}

function renderJobs(jobs) {
  const container = document.getElementById("job-container");
  container.innerHTML = "";

  if (jobs.length === 0) {
    container.innerHTML = `
            <div class="col-span-full py-20 text-center">
                <p class="text-gray-400 text-lg font-light">ไม่พบตำแหน่งงานที่ค้นหา</p>
            </div>`;
    return;
  }

  jobs.forEach((job) => {
    let compensationHTML = "";
    if (job.compensationAmount && job.compensationAmount > 0) {
      compensationHTML = `<span class="text-lg font-semibold text-gray-900">${formatNumber(
        job.compensationAmount
      )}</span> <span class="text-sm text-gray-500 font-light">${
        job.compensationType?.compensationType
      }</span>`;
    } else {
      compensationHTML = `<span class="text-gray-400 text-sm font-light">ไม่ระบุเงินเดือน</span>`;
    }

    let tagsHTML = "";
    if (job.tags && job.tags.length > 0) {
      tagsHTML = `<div class="flex flex-wrap gap-2 mt-4">`;
      job.tags.slice(0, 5).forEach((t) => {
        tagsHTML += `
          <span 
            title="${t.tagName}" 
            class="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded hover:bg-gray-200 transition cursor-help 
                   max-w-[150px] truncate block">
            ${t.tagName}
          </span>`;
      });
      tagsHTML += `</div>`;
    }

    let metaList = [];
    if (job.workingCondition) metaList.push(job.workingCondition);
    if (job.quota && job.quota > 0) metaList.push(`รับ ${job.quota} อัตรา`);
    if (job.openForCooperativeInternship)
      metaList.push(`<span class="text-black font-medium">สหกิจ</span>`);

    const metaHTML = metaList.join(
      ' <span class="text-gray-300 mx-2">•</span> '
    );

    let locationHTML = "";
    if (job.officeName) {
      const mapQuery = job.officeAddressLine1 || job.officeName;
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
      
      locationHTML = `
        <div class="mt-1 flex items-start gap-1 text-sm text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mt-0.5 flex-shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
            </svg>
            <a href="${mapUrl}" target="_blank" class="hover:text-blue-600 hover:underline transition leading-tight">
                ${job.officeName}
            </a>
        </div>
      `;
    }

    const cardHTML = `
            <div class="group bg-white p-6 rounded-xl border border-transparent shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] hover:shadow-lg hover:border-gray-100 transition duration-300 flex flex-col h-full">
                
                <div class="mb-4">
                    <h3 class="text-xl font-semibold text-gray-900 leading-snug group-hover:text-blue-600 transition">
                        <a href="https://cedtintern.cp.eng.chula.ac.th/opening/${job.openingId}/session/${job.sessionId}" target="_blank" class="focus:outline-none">
                            ${job.title}
                        </a>
                    </h3>
                    
                    <div class="mt-1">
                        <p class="text-base text-gray-500">
                            <a href="https://cedtintern.cp.eng.chula.ac.th/company/profile/${job.company?.companyId}" target="_blank" class="hover:text-gray-800 transition relative z-10">
                                ${job.company?.companyNameTh || "ไม่ระบุบริษัท"}
                            </a>
                        </p>
                        
                        ${locationHTML}
                    </div>
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
    container.insertAdjacentHTML("beforeend", cardHTML);
  });
}

initApp();