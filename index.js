// --- STATE ---
let currentChapter = 1;
let files = []; // { id, name, blob, selected }

// --- DOM ELEMENTS ---
const els = {
    // Nav
    tabs: document.querySelectorAll('.tab-btn'),
    views: document.querySelectorAll('.view-content'),
    sidebar: document.getElementById('sidebar'),
    toggleSidebar: document.getElementById('toggleSidebar'),

    // Editor
    editor: document.getElementById('editor'),
    chapterNum: document.getElementById('chapterNum'),
    nextNum: document.getElementById('nextNum'),
    btnReset: document.getElementById('btnReset'),
    btnMerge: document.getElementById('btnMerge'),
    btnClearOnly: document.getElementById('btnClearOnly'),

    // Lists
    sidebarList: document.getElementById('sidebarList'),
    managerList: document.getElementById('managerList'),
    fileCount: document.getElementById('fileCount'),
    
    // Checkboxes
    selectAllSidebar: document.getElementById('selectAllSidebar'),
    selectAllManager: document.getElementById('selectAllManager'),

    // Global
    toast: document.getElementById('toast'),
    btnDownloadAll: document.getElementById('btnDownloadAll'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected')
};

// --- INIT ---
function init() {
    updateChapterUI();
    
    // 1. Tab Switching
    els.tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active
            els.tabs.forEach(t => t.classList.remove('active'));
            els.views.forEach(v => v.classList.remove('active'));
            // Add active
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // 2. Sidebar Toggle
    els.toggleSidebar.addEventListener('click', () => els.sidebar.classList.toggle('collapsed'));

    // 3. Chapter Logic
    els.chapterNum.addEventListener('change', (e) => {
        let val = parseInt(e.target.value) || 1;
        currentChapter = val;
        updateChapterUI();
    });
    els.btnReset.addEventListener('click', () => {
        if(confirm('Reset số chương về 1?')) {
            currentChapter = 1;
            updateChapterUI();
        }
    });

    // 4. Action Buttons
    // Nút Gộp: Gộp xong -> Xóa text
    els.btnMerge.addEventListener('click', () => merge(true));
    
    // Nút Xóa trắng: Chỉ xóa text
    els.btnClearOnly.addEventListener('click', () => {
        if(confirm('Xóa trắng nội dung đang soạn?')) els.editor.value = '';
    });

    // 5. Select All Logic (Sync giữa 2 tab)
    const handleSelectAll = (checked) => {
        files.forEach(f => f.selected = checked);
        renderAllLists();
        els.selectAllSidebar.checked = checked;
        els.selectAllManager.checked = checked;
    };
    els.selectAllSidebar.addEventListener('change', (e) => handleSelectAll(e.target.checked));
    els.selectAllManager.addEventListener('change', (e) => handleSelectAll(e.target.checked));

    // 6. Bulk Actions
    els.btnDownloadAll.addEventListener('click', downloadBatch);
    els.btnDeleteSelected.addEventListener('click', deleteBatch);
}

// --- CORE LOGIC: MERGE ---
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
        showToast(`✅ Đã gộp: ${docName}`);
    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi hệ thống');
    }
}

// --- CORE LOGIC: DOCX GENERATOR (AUTO SPACING) ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const FONT_NAME = "Calibri";
    const FONT_SIZE = 32; // 16pt

    // XỬ LÝ TEXT: 
    // 1. Tách theo dòng mới (\n)
    // 2. Lọc bỏ các dòng trống hoàn toàn (trim() === '') để tránh bị double space nếu user đã cách sẵn
    // 3. Sau này Docx sẽ tự thêm spacing giữa các đoạn -> Tạo hiệu ứng cách 1 dòng chuẩn.
    const paragraphsRaw = rawContent.split('\n').filter(line => line.trim() !== '');

    const docChildren = [];

    // Tiêu đề
    docChildren.push(new Paragraph({
        children: [new TextRun({ text: titleText, font: FONT_NAME, size: FONT_SIZE })],
        spacing: { after: 240 } // Khoảng cách sau tiêu đề
    }));

    // Nội dung (Mỗi đoạn văn cách nhau khoảng 240twip ~ 1 dòng trống)
    paragraphsRaw.forEach(line => {
        docChildren.push(new Paragraph({
            children: [new TextRun({ text: line.trim(), font: FONT_NAME, size: FONT_SIZE })],
            spacing: { after: 240 } // Tạo khoảng trắng phía dưới đoạn văn
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
        els.sidebarList.innerHTML = '<div class="empty-text">Chưa có file</div>';
        return;
    }
    // Reverse để file mới nhất lên đầu
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
        els.managerList.innerHTML = '<div class="empty-state">Danh sách trống</div>';
        return;
    }
    [...files].reverse().forEach(f => {
        const div = document.createElement('div');
        div.className = 'row-item';
        div.innerHTML = `
            <div class="col-check"><input type="checkbox" ${f.selected ? 'checked' : ''} onchange="toggleSelect(${f.id})"></div>
            <div class="col-name" title="${f.name}">${f.name}</div>
            <div class="col-action">
                <button class="btn-icon btn-dl" onclick="downloadOne(${f.id})" title="Tải xuống">⬇</button>
                <button class="btn-icon btn-del" onclick="deleteOne(${f.id})" title="Xóa">🗑</button>
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

function downloadOne(id) {
    const f = files.find(x => x.id === id);
    if(f) saveAs(f.blob, f.name);
}

function deleteOne(id) {
    if(confirm('Bạn muốn xóa file này?')) {
        files = files.filter(f => f.id !== id);
        renderAllLists();
        showToast('Đã xóa file');
    }
}

function deleteBatch() {
    const selected = files.filter(f => f.selected);
    if(selected.length === 0) return showToast('⚠️ Chưa chọn file nào');
    
    if(confirm(`Xóa vĩnh viễn ${selected.length} file đã chọn?`)) {
        files = files.filter(f => !f.selected);
        renderAllLists();
        els.selectAllSidebar.checked = false;
        els.selectAllManager.checked = false;
        showToast('Đã xóa các file đã chọn');
    }
}

function downloadBatch() {
    const selected = files.filter(f => f.selected);
    if(selected.length === 0) return showToast('⚠️ Chưa chọn file để tải');

    const zip = new JSZip();
    selected.forEach(f => zip.file(f.name, f.blob));
    zip.generateAsync({type:"blob"}).then(c => saveAs(c, `Export_${Date.now()}.zip`));
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

// RUN
init();
