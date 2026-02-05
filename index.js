// --- STATE ---
let files = []; 

// --- HELPER: Đếm từ chuẩn MS Word ---
function countWords(text) {
    if (!text) return 0;
    // Tách từ dựa trên khoảng trắng và các dấu câu
    return text.trim().split(/[\s\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\-.\/:;<=>?@\[\]^`{|}~]+/).filter(Boolean).length;
}

// --- DOM ELEMENTS ---
const els = {
    tabs: document.querySelectorAll('.tab-pill'),
    views: document.querySelectorAll('.view-content'),
    sidebar: document.getElementById('sidebar'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    editor: document.getElementById('editor'),
    chapterTitle: document.getElementById('chapterTitle'),
    
    // Config
    autoGroup: document.getElementById('autoGroup'), 

    // Buttons
    btnMerge: document.getElementById('btnMerge'),
    btnClearOnly: document.getElementById('btnClearOnly'),
    btnDownloadAll: document.getElementById('btnDownloadAll'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected'),

    // Lists & Modals
    sidebarList: document.getElementById('sidebarList'),
    managerList: document.getElementById('managerList'),
    fileCount: document.getElementById('fileCount'),
    selectAllSidebar: document.getElementById('selectAllSidebar'),
    selectAllManager: document.getElementById('selectAllManager'),
    toast: document.getElementById('toast'),
    
    previewModal: document.getElementById('previewModal'),
    previewTitle: document.getElementById('previewTitle'),
    previewBody: document.getElementById('previewBody')
};

// --- INIT ---
function init() {
    // Chặn F5 mất dữ liệu
    window.addEventListener('beforeunload', function (e) {
        if (files.length > 0) { e.preventDefault(); e.returnValue = ''; }
    });

    renderAllLists();

    // UI Events
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
    els.btnClearOnly.addEventListener('click', () => { els.editor.value = ''; showToast('Đã xóa trắng'); });

    // Select All
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

// --- PREVIEW LOGIC ---
window.openPreview = function(id) {
    const f = files.find(x => x.id === id);
    if (!f) return;
    els.previewTitle.innerText = f.name;
    els.previewBody.innerText = f.rawContent;
    els.previewModal.classList.add('show');
}

window.closePreview = function() {
    els.previewModal.classList.remove('show');
}

// --- MERGE LOGIC (CORE) ---
async function merge(autoClear) {
    const contentToAdd = els.editor.value;
    if (!contentToAdd.trim()) return; // Không báo lỗi để tránh spam khi auto click

    const currentTitle = els.chapterTitle.value.trim() || "Chương Mới";
    
    // 1. Xử lý tên file (thay thế ký tự cấm của Windows : * ? " < > | bằng dấu -)
    // Ví dụ: "Chương 1: Mở đầu" -> "Chương 1 - Mở đầu.docx"
    let safeFileName = currentTitle.replace(/[:*?"<>|]/g, " -").trim();
    let headerTitle = currentTitle; // Giữ nguyên tiêu đề gốc (có dấu :) để hiện trong file Word
    let fileName = `${safeFileName}.docx`;

    // 2. Logic Gộp (Nếu bật checkbox)
    if (els.autoGroup.checked) {
        // Tìm số chương: "Chương 1.2" -> Gộp vào "Chương 1.docx"
        const match = currentTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
        if (match) {
            fileName = `Chương ${match[1]}.docx`;
        }
    }

    try {
        let targetFile = files.find(f => f.name === fileName);

        if (targetFile) {
            // === NỐI VÀO FILE CŨ ===
            targetFile.rawContent += "\n\n" + contentToAdd;
            targetFile.wordCount = countWords(targetFile.rawContent);
            targetFile.timestamp = Date.now(); // Đẩy lên đầu danh sách
            
            showToast(`📝 Đã nối: ${fileName} (${targetFile.wordCount} từ)`);
            
            // Tạo Blob mới
            const blob = await generateDocx(targetFile.headerInDoc, targetFile.rawContent);
            targetFile.blob = blob;

        } else {
            // === TẠO FILE MỚI ===
            const wc = countWords(contentToAdd);
            targetFile = { 
                id: Date.now(), 
                name: fileName, 
                headerInDoc: headerTitle,
                rawContent: contentToAdd, 
                wordCount: wc,
                blob: null, 
                selected: false,
                timestamp: Date.now()
            };
            files.push(targetFile);
            
            showToast(`⚡ Mới: ${fileName} (${wc} từ)`);
            
            const blob = await generateDocx(headerTitle, contentToAdd);
            targetFile.blob = blob;
        }

        // Tự động tăng số chương (UX)
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
        showToast('❌ Lỗi xử lý');
    }
}

// --- DOCX GENERATOR (FORMAT CHUẨN) ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    
    // Cấu hình Font
    const FONT_NAME = "Calibri";
    const FONT_SIZE = 32; // 32 half-points = 16pt

    const paragraphsRaw = rawContent.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const docChildren = [];

    // Header (Tiêu đề chương): KHÔNG BOLD, MÀU ĐEN, SIZE 16
    docChildren.push(new Paragraph({
        children: [new TextRun({ 
            text: titleText, 
            font: FONT_NAME, 
            size: FONT_SIZE,
            color: "000000"
        })],
        spacing: { after: 240 } // Cách đoạn 1 dòng (240 twips)
    }));

    // Body (Nội dung)
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
        // Click vào tên để mở Preview
        div.innerHTML = `
            <input type="checkbox" ${f.selected ? 'checked' : ''} onchange="toggleSelect(${f.id})">
            <span class="name-link" onclick="openPreview(${f.id})" title="Xem trước">${f.name}</span>
            <span class="badge-wc">${f.wordCount}w</span>
        `;
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
            <div class="col-name">
                <span class="name-link" onclick="openPreview(${f.id})">${f.name}</span>
            </div>
            <div class="col-wc">${f.wordCount} từ</div>
            <div class="col-action action-btns">
                <button class="mini-btn btn-dl" onclick="downloadOne(${f.id})">⬇</button>
                <button class="mini-btn btn-del" onclick="deleteOne(${f.id})">✕</button>
            </div>
        `;
        els.managerList.appendChild(div);
    });
}

// --- ACTIONS EXPORT TO WINDOW ---
window.toggleSelect = function(id) { const f = files.find(x => x.id === id); if(f) { f.selected = !f.selected; renderAllLists(); } }
window.downloadOne = function(id) { const f = files.find(x => x.id === id); if(f && f.blob) saveAs(f.blob, f.name); }
window.deleteOne = function(id) { if(confirm('Xóa file này?')) { files = files.filter(f => f.id !== id); renderAllLists(); } }

function downloadBatch() {
    const selected = files.filter(f => f.selected);
    if(!selected.length) return showToast('⚠️ Chưa chọn file');
    const zip = new JSZip();
    selected.forEach(f => zip.file(f.name, f.blob));
    zip.generateAsync({type:"blob"}).then(c => saveAs(c, `Truyen_Full_${Date.now()}.zip`));
}

function deleteBatch() {
    const selected = files.filter(f => f.selected);
    if(confirm(`Xóa ${selected.length} file đã chọn?`)) {
        files = files.filter(f => !f.selected);
        renderAllLists();
        els.selectAllSidebar.checked = false;
        els.selectAllManager.checked = false;
        showToast('Đã xóa xong');
    }
}

function showToast(msg) {
    els.toast.innerText = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2000);
}

// Start
init();
