// --- STATE ---
let files = []; 

// --- DOM ELEMENTS ---
const els = {
    tabs: document.querySelectorAll('.tab-pill'),
    views: document.querySelectorAll('.view-content'),
    sidebar: document.getElementById('sidebar'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    editor: document.getElementById('editor'),
    chapterTitle: document.getElementById('chapterTitle'),
    
    autoGroup: document.getElementById('autoGroup'), 

    btnMerge: document.getElementById('btnMerge'),
    btnClearOnly: document.getElementById('btnClearOnly'),
    btnDownloadAll: document.getElementById('btnDownloadAll'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected'),

    sidebarList: document.getElementById('sidebarList'),
    managerList: document.getElementById('managerList'),
    fileCount: document.getElementById('fileCount'),
    selectAllSidebar: document.getElementById('selectAllSidebar'),
    selectAllManager: document.getElementById('selectAllManager'),

    toast: document.getElementById('toast')
};

// --- INIT ---
function init() {
    window.addEventListener('beforeunload', function (e) {
        if (files.length > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    renderAllLists();

    els.toggleSidebar.addEventListener('click', () => els.sidebar.classList.toggle('collapsed'));
    
    els.tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            els.tabs.forEach(t => t.classList.remove('active'));
            els.views.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    els.btnMerge.addEventListener('click', () => merge(true));
    els.btnClearOnly.addEventListener('click', () => {
        els.editor.value = '';
        showToast('Đã xóa trắng khung nhập');
    });

    const handleSelectAll = (checked) => {
        files.forEach(f => f.selected = checked);
        renderAllLists();
        els.selectAllSidebar.checked = checked;
        els.selectAllManager.checked = checked;
    };
    els.selectAllSidebar.addEventListener('change', (e) => handleSelectAll(e.target.checked));
    els.selectAllManager.addEventListener('change', (e) => handleSelectAll(e.target.checked));
    els.btnDownloadAll.addEventListener('click', downloadBatch);
    els.btnDeleteSelected.addEventListener('click', deleteBatch);
}

// --- LOGIC TÊN FILE & HEADER THÔNG MINH ---
function parseChapterInfo(inputTitle) {
    // Xử lý tên file an toàn cho Windows
    let safeFileName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();

    // Nếu KHÔNG bật chế độ gộp -> Giữ nguyên mọi thứ
    if (!els.autoGroup.checked) {
        return { 
            fileName: `${safeFileName}.docx`, 
            headerTitle: inputTitle, 
            baseKey: safeFileName 
        };
    }
    
    // Nếu BẬT gộp: Tìm số chương
    const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
    
    if (match) {
        const baseKey = `Chương ${match[1]}`;
        
        // --- FIX MỚI Ở ĐÂY ---
        // Xử lý Tiêu đề hiển thị trong file Word (Header)
        // Tìm đoạn "Chương X.Y" và thay bằng "Chương X"
        // Ví dụ: "Chương 1.1: ABC" -> thành "Chương 1: ABC"
        let cleanHeader = inputTitle.replace(/((?:Chương|Chapter|Hồi)\s*\d+)\.\d+/i, "$1");

        return { 
            fileName: `${baseKey}.docx`, 
            headerTitle: cleanHeader, // Dùng tiêu đề đã làm sạch số lẻ
            baseKey: baseKey 
        };
    }
    
    return { 
        fileName: `${safeFileName}.docx`, 
        headerTitle: inputTitle,
        baseKey: safeFileName 
    };
}

// --- CORE MERGE ---
async function merge(autoClear) {
    const contentToAdd = els.editor.value;
    if (!contentToAdd.trim()) return showToast('⚠️ Chưa nhập nội dung!');

    const currentTitle = els.chapterTitle.value.trim() || "Chương Mới";
    
    // Lấy thông tin đã được xử lý (headerTitle giờ đã sạch, không còn .1)
    const { fileName, headerTitle, baseKey } = parseChapterInfo(currentTitle);

    try {
        let targetFile = files.find(f => f.name === fileName);

        if (targetFile) {
            // === NỐI FILE CŨ ===
            targetFile.rawContent += "\n\n" + contentToAdd;
            targetFile.timestamp = Date.now();

            showToast(`📝 Đang nối vào: ${fileName}...`);
            
            // Dùng lại headerInDoc (đã được làm sạch từ lúc tạo file)
            const newBlob = await generateDocx(targetFile.headerInDoc, targetFile.rawContent);
            targetFile.blob = newBlob;
            
            showToast(`✅ Đã lưu xong: ${fileName}`);

        } else {
            // === TẠO FILE MỚI ===
            targetFile = { 
                id: Date.now(), 
                name: fileName, 
                headerInDoc: headerTitle, // Lưu tiêu đề sạch "Chương 1: ABC"
                rawContent: contentToAdd, 
                blob: null, 
                selected: false,
                timestamp: Date.now()
            };
            files.push(targetFile);
            
            showToast(`⚡ Đang tạo file: ${fileName}...`);

            // Tạo file với tiêu đề sạch
            const blob = await generateDocx(headerTitle, contentToAdd);
            targetFile.blob = blob;
            
            showToast(`✅ Đã tạo xong: ${fileName}`);
        }

        // Tự động tăng số chương 1.1 -> 1.2
        const numberMatch = currentTitle.match(/(\d+)(\.(\d+))?/);
        if (numberMatch) {
            if (numberMatch[2]) {
                const main = numberMatch[1];
                const sub = parseInt(numberMatch[3]) + 1;
                els.chapterTitle.value = currentTitle.replace(numberMatch[0], `${main}.${sub}`);
            } else {
                const main = parseInt(numberMatch[1]) + 1;
                els.chapterTitle.value = currentTitle.replace(numberMatch[1], main);
            }
        }

        if(autoClear) els.editor.value = '';
        files.sort((a, b) => b.timestamp - a.timestamp);
        renderAllLists();

    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi xử lý file');
    }
}

// --- DOCX GENERATOR (FORMAT CHUẨN) ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    
    const FONT_NAME = "Calibri";
    const FONT_SIZE = 32; // Size 16

    const paragraphsRaw = rawContent.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const docChildren = [];

    // 1. HEADER (Tiêu đề sạch, không in đậm, size 16, màu đen)
    docChildren.push(new Paragraph({
        children: [new TextRun({ 
            text: titleText, 
            font: FONT_NAME, 
            size: FONT_SIZE,
            color: "000000"
        })],
        spacing: { after: 240 } // Cách 1 dòng
    }));

    // 2. NỘI DUNG
    paragraphsRaw.forEach(line => {
        docChildren.push(new Paragraph({
            children: [new TextRun({ 
                text: line, 
                font: FONT_NAME, 
                size: FONT_SIZE,
                color: "000000"
            })],
            spacing: { after: 240 } 
        }));
    });

    const doc = new Document({ sections: [{ children: docChildren }] });
    return Packer.toBlob(doc);
}

// --- RENDER UI ---
function renderAllLists() {
    els.fileCount.innerText = files.length;
    renderSidebar();
    renderManager();
}

function renderSidebar() {
    els.sidebarList.innerHTML = '';
    if (files.length === 0) {
        els.sidebarList.innerHTML = '<div class="empty-text">Chưa có file nào</div>';
        return;
    }
    files.forEach(f => {
        const div = document.createElement('div');
        div.className = `file-item ${f.selected ? 'selected' : ''}`;
        div.onclick = (e) => {
            if(e.target.type !== 'checkbox') toggleSelect(f.id);
        };
        const statusIcon = f.blob ? '📄' : '⏳'; 
        div.innerHTML = `<input type="checkbox" ${f.selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${f.id})"><span>${statusIcon} ${f.name}</span>`;
        els.sidebarList.appendChild(div);
    });
}

function renderManager() {
    els.managerList.innerHTML = '';
    if (files.length === 0) {
        els.managerList.innerHTML = '<div style="text-align:center; padding:30px; color:#9ca3af">Danh sách trống</div>';
        return;
    }
    files.forEach(f => {
        const div = document.createElement('div');
        div.className = 'file-row';
        div.innerHTML = `
            <div class="col-check"><input type="checkbox" ${f.selected ? 'checked' : ''} onchange="toggleSelect(${f.id})"></div>
            <div class="col-name" style="font-weight:600;">${f.name}</div>
            <div class="col-action action-btns">
                <button class="mini-btn btn-dl" onclick="downloadOne(${f.id})" title="Tải file">⬇</button>
                <button class="mini-btn btn-del" onclick="deleteOne(${f.id})" title="Xóa file">✕</button>
            </div>
        `;
        els.managerList.appendChild(div);
    });
}

function toggleSelect(id) {
    const f = files.find(x => x.id === id);
    if(f) { f.selected = !f.selected; renderAllLists(); }
}

function showToast(msg) {
    els.toast.innerText = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2000);
}

function downloadOne(id) {
    const f = files.find(x => x.id === id);
    if(f && f.blob) saveAs(f.blob, f.name);
    else showToast('⚠️ File đang tạo, đợi chút!');
}

function deleteOne(id) {
    if(confirm('Xóa file này?')) {
        files = files.filter(f => f.id !== id);
        renderAllLists();
    }
}

function downloadBatch() {
    const selected = files.filter(f => f.selected);
    if(!selected.length) return showToast('⚠️ Chưa chọn file');
    if (selected.some(f => !f.blob)) return showToast('⏳ Có file chưa xử lý xong, vui lòng đợi...');

    const zip = new JSZip();
    selected.forEach(f => zip.file(f.name, f.blob));
    zip.generateAsync({type:"blob"}).then(c => saveAs(c, `Truyen_Full_${Date.now()}.zip`));
}

function deleteBatch() {
    const selected = files.filter(f => f.selected);
    if(!selected.length) return showToast('⚠️ Chưa chọn file');
    if(confirm(`Xóa ${selected.length} file đã chọn?`)) {
        files = files.filter(f => !f.selected);
        renderAllLists();
        els.selectAllSidebar.checked = false;
        els.selectAllManager.checked = false;
        showToast('Đã xóa xong');
    }
}

init();
