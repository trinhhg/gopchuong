// --- STATE ---
let currentChapter = 1;
let files = []; 

// --- DOM ELEMENTS ---
const els = {
    tabs: document.querySelectorAll('.tab-pill'),
    views: document.querySelectorAll('.view-content'),
    sidebar: document.getElementById('sidebar'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    editor: document.getElementById('editor'),
    chapterNum: document.getElementById('chapterNum'),
    nextNum: document.getElementById('nextNum'),
    
    // Buttons
    btnReset: document.getElementById('btnReset'),
    btnMerge: document.getElementById('btnMerge'),
    btnClearOnly: document.getElementById('btnClearOnly'),
    btnDownloadAll: document.getElementById('btnDownloadAll'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected'),

    // Lists & Checkboxes
    sidebarList: document.getElementById('sidebarList'),
    managerList: document.getElementById('managerList'),
    fileCount: document.getElementById('fileCount'),
    selectAllSidebar: document.getElementById('selectAllSidebar'),
    selectAllManager: document.getElementById('selectAllManager'),

    toast: document.getElementById('toast')
};

// --- INIT ---
function init() {
    updateChapterUI();

    // 1. Sidebar Logic (Sửa lỗi che khuất)
    els.toggleSidebar.addEventListener('click', () => {
        els.sidebar.classList.toggle('collapsed');
    });

    // 2. Tab Logic
    els.tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            els.tabs.forEach(t => t.classList.remove('active'));
            els.views.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // 3. Reset Button Logic (Không Confirm - Reset ngay)
    els.btnReset.addEventListener('click', () => {
        currentChapter = 1;
        updateChapterUI();
        showToast('↺ Đã reset về chương 1');
    });

    // 4. Merge & Clear
    els.btnMerge.addEventListener('click', () => merge(true));
    els.btnClearOnly.addEventListener('click', () => {
        els.editor.value = '';
        showToast('Đã xóa trắng khung nhập');
    });

    // 5. Input Logic
    els.chapterNum.addEventListener('change', (e) => {
        let val = parseInt(e.target.value) || 1;
        currentChapter = val;
        updateChapterUI();
    });

    // 6. Select All & Bulk Actions
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

// --- MERGE LOGIC ---
async function merge(autoClear) {
    const rawContent = els.editor.value;
    if (!rawContent.trim()) return showToast('⚠️ Chưa nhập nội dung!');

    const title = `Chương ${currentChapter}`;
    const docName = `${title}.docx`;

    try {
        const blob = await generateDocx(title, rawContent);
        
        files.push({ id: Date.now(), name: docName, blob, selected: false });
        currentChapter++;
        updateChapterUI();
        
        if(autoClear) els.editor.value = '';
        renderAllLists();
        showToast(`⚡ Đã tạo: ${docName}`);
    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi tạo file');
    }
}

// --- DOCX GENERATOR (AUTO SPACING LOGIC) ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const FONT_NAME = "Calibri";
    const FONT_SIZE = 32; // 16pt

    // LOGIC TỰ ĐỘNG CÁCH DÒNG:
    // 1. Split text bằng \n
    // 2. Trim từng dòng và Filter bỏ dòng rỗng để tránh khoảng trống thừa thãi
    // 3. Tạo Paragraph với spacing after = 240 (tương đương 1 dòng trống)
    
    const paragraphsRaw = rawContent.split('\n')
        .map(line => line.trim())       // Xóa khoảng trắng thừa đầu đuôi
        .filter(line => line.length > 0); // Bỏ dòng trống tuyệt đối

    const docChildren = [];

    // Header Chương
    docChildren.push(new Paragraph({
        children: [new TextRun({ text: titleText, font: FONT_NAME, size: FONT_SIZE })],
        spacing: { after: 300 } // Cách nội dung một chút
    }));

    // Nội dung
    paragraphsRaw.forEach(line => {
        docChildren.push(new Paragraph({
            children: [new TextRun({ text: line, font: FONT_NAME, size: FONT_SIZE })],
            spacing: { after: 240 } // Tự động tạo khoảng cách dưới mỗi đoạn
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
    [...files].reverse().forEach(f => {
        const div = document.createElement('div');
        div.className = `file-item ${f.selected ? 'selected' : ''}`;
        div.onclick = () => toggleSelect(f.id);
        div.innerHTML = `<input type="checkbox" ${f.selected ? 'checked' : ''}><span>${f.name}</span>`;
        els.sidebarList.appendChild(div);
    });
}

function renderManager() {
    els.managerList.innerHTML = '';
    if (files.length === 0) {
        els.managerList.innerHTML = '<div style="text-align:center; padding:30px; color:#9ca3af">Danh sách trống</div>';
        return;
    }
    [...files].reverse().forEach(f => {
        const div = document.createElement('div');
        div.className = 'file-row';
        div.innerHTML = `
            <div class="col-check"><input type="checkbox" ${f.selected ? 'checked' : ''} onchange="toggleSelect(${f.id})"></div>
            <div class="col-name">${f.name}</div>
            <div class="col-action action-btns">
                <button class="mini-btn btn-dl" onclick="downloadOne(${f.id})">⬇</button>
                <button class="mini-btn btn-del" onclick="deleteOne(${f.id})">✕</button>
            </div>
        `;
        els.managerList.appendChild(div);
    });
}

// --- ACTIONS ---
function toggleSelect(id) {
    const f = files.find(x => x.id === id);
    if(f) {
        f.selected = !f.selected;
        renderAllLists();
    }
}

function updateChapterUI() {
    els.chapterNum.value = currentChapter;
    els.nextNum.innerText = currentChapter + 1;
}

function showToast(msg) {
    els.toast.innerText = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2000);
}

// Helpers cho Download/Delete
function downloadOne(id) {
    const f = files.find(x => x.id === id);
    if(f) saveAs(f.blob, f.name);
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
    const zip = new JSZip();
    selected.forEach(f => zip.file(f.name, f.blob));
    zip.generateAsync({type:"blob"}).then(c => saveAs(c, `Truyen_Export_${Date.now()}.zip`));
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

// Start
init();
