// --- STATE ---
let currentChapter = 1;
let files = []; // { id, name, blob, selected }

// --- DOM ELEMENTS ---
const els = {
    editor: document.getElementById('editor'),
    chapterNum: document.getElementById('chapterNum'),
    nextNum: document.getElementById('nextNum'),
    sidebarList: document.getElementById('sidebarList'),
    fileCount: document.getElementById('fileCount'),
    sidebar: document.getElementById('sidebar'),
    toast: document.getElementById('toast'),
    selectAll: document.getElementById('selectAll')
};

// --- INIT & EVENTS ---
function init() {
    updateUI();
    
    // Nút Toggle Sidebar
    document.getElementById('toggleSidebar').addEventListener('click', () => {
        els.sidebar.classList.toggle('collapsed');
    });

    // Input số chương
    els.chapterNum.addEventListener('change', (e) => {
        let val = parseInt(e.target.value) || 1;
        currentChapter = val;
        updateUI();
    });

    // Các nút hành động
    document.getElementById('btnMerge').addEventListener('click', () => merge(false));
    document.getElementById('btnMergeClear').addEventListener('click', () => merge(true));
    document.getElementById('btnReset').addEventListener('click', () => {
        if(confirm('Reset số chương về 1?')) {
            currentChapter = 1;
            updateUI();
        }
    });

    // Checkbox All
    els.selectAll.addEventListener('change', (e) => {
        files.forEach(f => f.selected = e.target.checked);
        renderList();
    });

    // Download All
    document.getElementById('btnDownloadAll').addEventListener('click', downloadAll);
}

// --- LOGIC GỘP CHƯƠNG (QUAN TRỌNG) ---
async function merge(clear) {
    const content = els.editor.value;
    if (!content.trim()) return showToast('⚠️ Chưa có nội dung!');

    const title = `Chương ${currentChapter}`;
    const docName = `${title}.docx`;

    try {
        const blob = await generateDocx(title, content);
        
        files.push({ id: Date.now(), name: docName, blob, selected: false });
        
        currentChapter++;
        updateUI();
        if(clear) els.editor.value = '';
        
        renderList();
        showToast(`✅ Đã gộp: ${docName}`);
    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi tạo file');
    }
}

// --- LOGIC TẠO FILE DOCX (CHUẨN FONT CALIBRI 16) ---
function generateDocx(titleText, contentText) {
    const { Document, Packer, Paragraph, TextRun } = docx;

    // Yêu cầu: Font Calibri, Size 16 (Trong docxjs size 32 = 16pt)
    const FONT_NAME = "Calibri";
    const FONT_SIZE = 32; 

    // Tách dòng nội dung
    const lines = contentText.split('\n');

    // Mảng chứa các đoạn văn
    const paragraphs = [];

    // 1. Dòng tiêu đề: "Chương X" (Không căn giữa, format y hệt văn bản thường)
    paragraphs.push(new Paragraph({
        children: [
            new TextRun({
                text: titleText,
                font: FONT_NAME,
                size: FONT_SIZE,
                bold: false // Theo yêu cầu "không màu mè", để bold=false hoặc true tùy ý bạn, ở đây để false cho giống text thường
            })
        ],
        spacing: { after: 120 } // Khoảng cách dòng một chút
    }));

    // 2. Nội dung bên dưới
    lines.forEach(line => {
        paragraphs.push(new Paragraph({
            children: [
                new TextRun({
                    text: line,
                    font: FONT_NAME,
                    size: FONT_SIZE
                })
            ],
            spacing: { after: 120 }
        }));
    });

    const doc = new Document({
        sections: [{
            properties: {},
            children: paragraphs
        }]
    });

    return Packer.toBlob(doc);
}

// --- RENDER SIDEBAR ---
function renderList() {
    els.fileCount.innerText = files.length;
    els.sidebarList.innerHTML = '';

    if (files.length === 0) {
        els.sidebarList.innerHTML = '<div class="empty-text">Chưa có file</div>';
        return;
    }

    // Đảo ngược để file mới nhất lên đầu
    [...files].reverse().forEach(file => {
        const div = document.createElement('div');
        div.className = `file-item ${file.selected ? 'selected' : ''}`;
        div.onclick = () => toggleSelect(file.id);
        
        div.innerHTML = `
            <input type="checkbox" ${file.selected ? 'checked' : ''}>
            <span>${file.name}</span>
            <button class="btn-dl-mini" onclick="event.stopPropagation(); downloadOne(${file.id})">⬇</button>
        `;
        els.sidebarList.appendChild(div);
    });
}

// --- HELPERS ---
function updateUI() {
    els.chapterNum.value = currentChapter;
    els.nextNum.innerText = currentChapter + 1;
}

function toggleSelect(id) {
    const f = files.find(x => x.id === id);
    if(f) {
        f.selected = !f.selected;
        renderList();
    }
}

function downloadOne(id) {
    const f = files.find(x => x.id === id);
    if(f) saveAs(f.blob, f.name);
}

function downloadAll() {
    const selected = files.filter(f => f.selected);
    if(selected.length === 0) return showToast('⚠️ Chọn ít nhất 1 file');

    const zip = new JSZip();
    selected.forEach(f => zip.file(f.name, f.blob));
    zip.generateAsync({type:"blob"}).then(c => saveAs(c, `Export_${Date.now()}.zip`));
}

function showToast(msg) {
    const t = els.toast;
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
}

// Start
init();
