// --- STATE ---
let files = []; 

// --- DOM ELEMENTS ---
const els = {
    tabs: document.querySelectorAll('.tab-pill'),
    views: document.querySelectorAll('.view-content'),
    sidebar: document.getElementById('sidebar'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    editor: document.getElementById('editor'),
    
    // ĐÃ SỬA: Lấy input theo ID mới
    chapterTitle: document.getElementById('chapterTitle'),
    
    // Buttons
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
    renderAllLists();

    // 1. Sidebar Logic
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

    // 3. Merge Logic (Nút Gộp)
    els.btnMerge.addEventListener('click', () => merge(true));

    // 4. Clear Logic
    els.btnClearOnly.addEventListener('click', () => {
        els.editor.value = '';
        showToast('Đã xóa trắng khung nhập');
    });

    // 5. Select All & Bulk Actions
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

// --- MERGE LOGIC (CỐT LÕI) ---
async function merge(autoClear) {
    const rawContent = els.editor.value;
    if (!rawContent.trim()) return showToast('⚠️ Chưa nhập nội dung!');

    // Lấy tên từ ô nhập, nếu rỗng thì đặt tạm tên
    let titleText = els.chapterTitle.value.trim() || "Chương Mới";
    const docName = `${titleText}.docx`;

    try {
        const blob = await generateDocx(titleText, rawContent);
        
        // Thêm vào danh sách file
        files.push({ id: Date.now(), name: docName, blob, selected: false });
        
        // --- LOGIC TỰ TĂNG SỐ ---
        // Tự động tìm số cuối cùng trong chuỗi và cộng thêm 1
        // VD: "Chương 1" -> "Chương 2", "Chương 1.1" -> "Chương 1.2"
        const nextTitle = titleText.replace(/(\d+)(?!.*\d)/, (match) => {
            return parseInt(match) + 1;
        });
        
        if (nextTitle !== titleText) {
            els.chapterTitle.value = nextTitle; // Cập nhật ô input cho chương sau
        }

        if(autoClear) els.editor.value = ''; // Xóa nội dung cũ để chờ chương mới
        renderAllLists();
        showToast(`⚡ Đã tạo: ${docName}`);

    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi tạo file');
    }
}

// --- DOCX GENERATOR ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const FONT_NAME = "Calibri";
    const FONT_SIZE = 32; // 16pt (docx tính half-points)

    // Xử lý xuống dòng: Tách dòng, trim, bỏ dòng rỗng
    const paragraphsRaw = rawContent.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const docChildren = [];

    // Header (Tên chương)
    docChildren.push(new Paragraph({
        children: [new TextRun({ text: titleText, font: FONT_NAME, size: FONT_SIZE, bold: true })],
        spacing: { after: 300 }
    }));

    // Body (Nội dung)
    paragraphsRaw.forEach(line => {
        docChildren.push(new Paragraph({
            children: [new TextRun({ text: line, font: FONT_NAME, size: FONT_SIZE })],
            spacing: { after: 240 } // Khoảng cách đoạn
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
        div.onclick = (e) => {
            // Click vào text thì chọn, click vào checkbox thì để checkbox lo
            if(e.target.type !== 'checkbox') toggleSelect(f.id);
        };
        div.innerHTML = `<input type="checkbox" ${f.selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${f.id})"><span>${f.name}</span>`;
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
                <button class="mini-btn btn-dl" onclick="downloadOne(${f.id})" title="Tải file này">⬇</button>
                <button class="mini-btn btn-del" onclick="deleteOne(${f.id})" title="Xóa file này">✕</button>
            </div>
        `;
        els.managerList.appendChild(div);
    });
}

// --- ACTIONS & HELPERS ---
function toggleSelect(id) {
    const f = files.find(x => x.id === id);
    if(f) {
        f.selected = !f.selected;
        renderAllLists();
    }
}

function showToast(msg) {
    els.toast.innerText = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2000);
}

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

// Start App
init();
