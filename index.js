// --- CONFIG & STATE ---
const STATE = {
    currentChapter: 1,
    files: [] // { id, name, blob, selected }
};

// --- DOM ELEMENTS ---
const els = {
    // Tabs
    tabs: document.querySelectorAll('.tab-btn'),
    contents: document.querySelectorAll('.tab-content'),
    
    // Inputs
    chapterNum: document.getElementById('currentChapterInput'),
    nextLabel: document.getElementById('nextChapterLabel'),
    text: document.getElementById('textContent'),
    
    // Buttons
    btnMerge: document.getElementById('btnMerge'),
    btnMergeClear: document.getElementById('btnMergeClear'),
    btnReset: document.getElementById('btnResetNumber'),
    
    // Sidebar & Lists
    sidebarList: document.getElementById('sidebarFileList'),
    tabList: document.getElementById('tabFileList'),
    fileCount: document.getElementById('fileCountBadge'),
    checkAllSidebar: document.getElementById('selectAllSidebar'),
    
    // Download Buttons
    btnDlSidebar: document.getElementById('btnDownloadBatchSidebar'),
    btnDlTab: document.getElementById('btnDownloadBatchTab'),
    
    // Mobile
    toggleSidebar: document.getElementById('toggleSidebarBtn'),
    sidebar: document.getElementById('sidebar'),
    overlay: document.getElementById('overlay'),
    
    // Toast
    toast: document.getElementById('toast')
};

// --- INIT ---
function init() {
    updateChapterUI();
    bindEvents();
}

// --- LOGIC: CHUYỂN TAB ---
function switchTab(tabId) {
    els.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    els.contents.forEach(c => c.classList.toggle('active', c.id === tabId));
}

// --- LOGIC: UPDATE UI SỐ CHƯƠNG ---
function updateChapterUI() {
    els.chapterNum.value = STATE.currentChapter;
    els.nextLabel.textContent = STATE.currentChapter + 1;
}

// --- LOGIC: RENDER LIST FILE (ĐỒNG BỘ SIDEBAR & TAB 2) ---
function renderLists() {
    els.fileCount.textContent = STATE.files.length;
    
    // Render Sidebar (Dạng gọn)
    const sidebarHTML = STATE.files.map(f => createItemHTML(f, 'sidebar')).reverse().join('');
    els.sidebarList.innerHTML = sidebarHTML || '<div class="empty-state-small">Trống</div>';

    // Render Tab List (Dạng chi tiết hơn nếu cần, nhưng hiện tại dùng chung structure)
    const tabHTML = STATE.files.map(f => createItemHTML(f, 'tab')).reverse().join(''); // Reverse để mới nhất lên đầu
    els.tabList.innerHTML = tabHTML || '<div class="empty-state">Chưa có chương nào được gộp</div>';
    
    // Re-bind events cho checkbox và nút download lẻ
    bindDynamicEvents();
}

function createItemHTML(file, context) {
    return `
        <div class="file-item ${file.selected ? 'selected' : ''}" onclick="toggleSelect(${file.id})">
            <input type="checkbox" ${file.selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${file.id})">
            <span class="name" title="${file.name}">${file.name}</span>
            <div class="actions">
                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); downloadSingle(${file.id})">⬇</button>
            </div>
        </div>
    `;
}

// --- LOGIC: GỘP CHƯƠNG (CORE) ---
async function handleMerge(clear) {
    const text = els.text.value;
    if (!text.trim()) {
        showToast('⚠️ Chưa nhập nội dung!');
        return;
    }

    const docName = `Chương ${STATE.currentChapter}.docx`;
    
    try {
        const blob = await createDocx(text, `Chương ${STATE.currentChapter}`);
        
        STATE.files.push({
            id: Date.now(),
            name: docName,
            blob: blob,
            selected: false
        });

        // Update Logic
        STATE.currentChapter++;
        updateChapterUI();
        
        if (clear) els.text.value = '';
        
        renderLists();
        showToast(`✅ Đã tạo: ${docName}`);
        
    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi khi tạo file');
    }
}

// --- LOGIC: TẠO DOCX (Thư viện) ---
function createDocx(text, title) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;
    const lines = text.split('\n');
    
    const children = [
        new Paragraph({
            text: title,
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 240, before: 240 }
        }),
        ...lines.map(line => new Paragraph({
            children: [new TextRun({ text: line, size: 24 })],
            spacing: { after: 120 }
        }))
    ];

    const doc = new Document({ sections: [{ children }] });
    return Packer.toBlob(doc);
}

// --- EVENTS ---
function bindEvents() {
    // Tabs
    els.tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    // Inputs
    els.chapterNum.addEventListener('change', (e) => {
        let val = parseInt(e.target.value);
        if (val < 1 || isNaN(val)) val = 1;
        STATE.currentChapter = val;
        updateChapterUI();
    });

    // Actions
    els.btnMerge.addEventListener('click', () => handleMerge(false));
    els.btnMergeClear.addEventListener('click', () => handleMerge(true));
    els.btnReset.addEventListener('click', () => {
        if(confirm('Chỉ reset số chương về 1?')) {
            STATE.currentChapter = 1;
            updateChapterUI();
            showToast('Đã reset số chương');
        }
    });

    // Checkbox All
    els.checkAllSidebar.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        STATE.files.forEach(f => f.selected = isChecked);
        renderLists();
    });

    // Batch Download
    els.btnDlSidebar.addEventListener('click', downloadBatch);
    els.btnDlTab.addEventListener('click', downloadBatch);

    // Mobile Sidebar
    els.toggleSidebar.addEventListener('click', () => {
        els.sidebar.classList.add('open');
        els.overlay.classList.add('open');
    });
    els.overlay.addEventListener('click', () => {
        els.sidebar.classList.remove('open');
        els.overlay.classList.remove('open');
    });
}

function bindDynamicEvents() {
    // Logic này đã được nhúng vào onclick trong HTML string để đơn giản hóa
}

// --- HELPERS ---
function toggleSelect(id) {
    const f = STATE.files.find(x => x.id === id);
    if (f) {
        f.selected = !f.selected;
        renderLists(); // Re-render để update UI selected state
    }
}

function downloadSingle(id) {
    const f = STATE.files.find(x => x.id === id);
    if (f) saveAs(f.blob, f.name);
}

function downloadBatch() {
    const selected = STATE.files.filter(f => f.selected);
    if (selected.length === 0) {
        showToast('⚠️ Chưa chọn file nào');
        return;
    }

    const zip = new JSZip();
    selected.forEach(f => zip.file(f.name, f.blob));
    
    zip.generateAsync({type:"blob"}).then(content => {
        saveAs(content, `Chapter_Export_${Date.now()}.zip`);
        showToast(`📦 Đang tải ${selected.length} file...`);
    });
}

function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2000);
}

// Run
init();
