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
    
    // Config Mới
    autoGroup: document.getElementById('autoGroup'), 

    // Buttons
    btnMerge: document.getElementById('btnMerge'),
    btnClearOnly: document.getElementById('btnClearOnly'),
    btnDownloadAll: document.getElementById('btnDownloadAll'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected'),

    // Lists
    sidebarList: document.getElementById('sidebarList'),
    managerList: document.getElementById('managerList'),
    fileCount: document.getElementById('fileCount'),
    selectAllSidebar: document.getElementById('selectAllSidebar'),
    selectAllManager: document.getElementById('selectAllManager'),

    toast: document.getElementById('toast')
};

// --- INIT ---
function init() {
    // 1. BẢO VỆ DỮ LIỆU: Chặn F5 khi có file
    window.addEventListener('beforeunload', function (e) {
        if (files.length > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    renderAllLists();

    // Event Listeners UI
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

// --- LOGIC XỬ LÝ TÊN FILE ---
function parseChapterName(inputTitle) {
    // Nếu tắt checkbox -> Dùng tên gốc hoàn toàn
    if (!els.autoGroup.checked) {
        return { baseName: inputTitle };
    }

    // Regex tìm số: "Chương 1.1" -> Lấy "Chương 1"
    const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
    
    if (match) {
        // Trả về tên file gốc là "Chương X"
        return { baseName: `Chương ${match[1]}` };
    }

    // Các trường hợp khác (Ngoại truyện...) giữ nguyên
    return { baseName: inputTitle };
}

// --- HÀM GỘP & LƯU ---
async function merge(autoClear) {
    const contentToAdd = els.editor.value;
    if (!contentToAdd.trim()) return showToast('⚠️ Chưa nhập nội dung!');

    const currentTitle = els.chapterTitle.value.trim() || "Chương Mới";
    
    // 1. Tính toán tên file gốc
    const { baseName } = parseChapterName(currentTitle);
    const fileName = `${baseName}.docx`;

    try {
        // 2. Tìm xem file này đã có chưa
        const existingFileIndex = files.findIndex(f => f.name === fileName);

        if (existingFileIndex !== -1) {
            // === NỐI VÀO FILE CŨ ===
            const oldFile = files[existingFileIndex];
            
            // Nối nội dung mới vào đuôi
            const newRawContent = oldFile.rawContent + "\n\n" + contentToAdd;
            
            // Tạo lại file Docx với nội dung đã nối
            const newBlob = await generateDocx(baseName, newRawContent);

            // Cập nhật file trong list
            files[existingFileIndex] = {
                ...oldFile,
                rawContent: newRawContent,
                blob: newBlob,
                timestamp: Date.now() // Update time để sort lên đầu
            };

            showToast(`🔗 Đã nối vào: ${fileName}`);

        } else {
            // === TẠO FILE MỚI ===
            const blob = await generateDocx(currentTitle, contentToAdd);
            
            files.push({ 
                id: Date.now(), 
                name: fileName, 
                rawContent: contentToAdd, 
                blob: blob, 
                selected: false 
            });

            showToast(`⚡ Đã tạo mới: ${fileName}`);
        }

        // 3. Tự động tăng số chương (1.1 -> 1.2)
        const numberMatch = currentTitle.match(/(\d+)(\.(\d+))?/);
        if (numberMatch) {
            if (numberMatch[2]) {
                // Có dạng 1.1 -> Tăng phần thập phân
                const main = numberMatch[1];
                const sub = parseInt(numberMatch[3]) + 1;
                els.chapterTitle.value = currentTitle.replace(numberMatch[0], `${main}.${sub}`);
            } else {
                // Có dạng 1 -> Tăng phần nguyên
                const main = parseInt(numberMatch[1]) + 1;
                els.chapterTitle.value = currentTitle.replace(numberMatch[1], main);
            }
        }

        if(autoClear) els.editor.value = '';
        
        // Sắp xếp file mới nhất lên đầu
        files.sort((a, b) => b.id - a.id); 
        renderAllLists();

    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi xử lý file');
    }
}

// --- TẠO DOCX ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
    const FONT_NAME = "Calibri";
    const FONT_SIZE = 32; // 16pt

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

    // Nội dung
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
    setTimeout(() => els.toast.classList.remove('show'), 3000);
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
