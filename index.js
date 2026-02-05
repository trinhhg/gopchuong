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
    // Chặn F5
    window.addEventListener('beforeunload', function (e) {
        if (files.length > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
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
    els.btnClearOnly.addEventListener('click', () => {
        els.editor.value = '';
        showToast('Đã xóa trắng khung nhập');
    });

    // Bulk Actions
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

// --- LOGIC TÊN FILE ---
function parseChapterName(inputTitle) {
    if (!els.autoGroup.checked) return { baseName: inputTitle };
    
    // Regex lấy số: "Chương 1.1" -> "Chương 1"
    const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
    if (match) return { baseName: `Chương ${match[1]}` };
    
    return { baseName: inputTitle };
}

// --- CORE MERGE (Đã Fix Race Condition) ---
async function merge(autoClear) {
    const contentToAdd = els.editor.value;
    if (!contentToAdd.trim()) return showToast('⚠️ Chưa nhập nội dung!');

    const currentTitle = els.chapterTitle.value.trim() || "Chương Mới";
    const { baseName } = parseChapterName(currentTitle);
    const fileName = `${baseName}.docx`;

    try {
        // 1. Tìm file trong bộ nhớ
        let targetFile = files.find(f => f.name === fileName);

        if (targetFile) {
            // === NỐI FILE CŨ ===
            // QUAN TRỌNG: Cập nhật text NGAY LẬP TỨC (Synchronous)
            // Để lượt bấm tiếp theo nhìn thấy dữ liệu mới ngay
            targetFile.rawContent += "\n\n" + contentToAdd;
            targetFile.timestamp = Date.now(); // Đẩy lên đầu danh sách

            showToast(`📝 Đang ghép vào: ${fileName}...`);
            
            // Tạo Blob mới (Chạy ngầm, không chặn việc gộp tiếp theo)
            // Ta dùng hàm generateDocx nhưng không await để chặn luồng chính quá lâu
            // Nhưng cần await để đảm bảo nút Download tải đúng file mới nhất
            const newBlob = await generateDocx(baseName, targetFile.rawContent);
            targetFile.blob = newBlob;
            
            showToast(`✅ Đã lưu xong: ${fileName}`);

        } else {
            // === TẠO FILE MỚI ===
            // QUAN TRỌNG: Tạo slot trong mảng NGAY LẬP TỨC (để chống trùng)
            targetFile = { 
                id: Date.now(), 
                name: fileName, 
                rawContent: contentToAdd, 
                blob: null, // Blob sẽ có sau
                selected: false,
                timestamp: Date.now()
            };
            files.push(targetFile);
            
            showToast(`⚡ Đang tạo file: ${fileName}...`);

            const blob = await generateDocx(currentTitle, contentToAdd);
            targetFile.blob = blob;
            
            showToast(`✅ Đã tạo xong: ${fileName}`);
        }

        // 2. Logic tự tăng số chương (1.1 -> 1.2)
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
        
        // Sắp xếp và Render lại
        files.sort((a, b) => b.timestamp - a.timestamp);
        renderAllLists();

    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi xử lý file');
    }
}

// --- DOCX GENERATOR ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
    const FONT_NAME = "Calibri";
    const FONT_SIZE = 32; 

    // Tách dòng
    const paragraphsRaw = rawContent.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const docChildren = [];

    // Header File
    docChildren.push(new Paragraph({
        children: [new TextRun({ text: titleText, font: FONT_NAME, size: 36, bold: true })],
        spacing: { after: 400 },
        heading: HeadingLevel.HEADING_1
    }));

    // Body
    paragraphsRaw.forEach(line => {
        docChildren.push(new Paragraph({
            children: [new TextRun({ text: line, font: FONT_NAME, size: FONT_SIZE })],
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
        // Thêm icon trạng thái
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

// --- ACTIONS ---
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
    
    // Kiểm tra xem có file nào chưa tạo xong blob không
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

// Start
init();
