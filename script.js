document.addEventListener('DOMContentLoaded', () => {
    const paletteBlocks = document.querySelectorAll('.palette .draggable');
    const workspace = document.getElementById('workspace');
    const propertiesContent = document.getElementById('properties-content');
    const workspacePlaceholder = document.querySelector('.workspace-placeholder');
    const connectionsSVG = document.getElementById('connections-svg');
    const SVG_NS = "http://www.w3.org/2000/svg";

    let draggedItem = null;
    let activeBlock = null;
    let blockIdCounter = 0;
    let connectionIdCounter = 0;
    
    let pipeline = {
        blocks: {}, 
        connections: {} 
    };

    let isConnecting = false;
    let tempLine = null;
    let startConnectionInfo = null; 

    updateWorkspacePlaceholder();

    paletteBlocks.forEach(block => {
        block.addEventListener('dragstart', (e) => {
            draggedItem = block;
        });
        block.addEventListener('dragend', () => {
            draggedItem = null;
        });
    });

    workspace.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedItem || isConnecting) { 
            workspace.classList.add('drag-over');
        }
    });

    workspace.addEventListener('dragleave', () => {
        workspace.classList.remove('drag-over');
    });

    workspace.addEventListener('drop', (e) => {
        e.preventDefault();
        workspace.classList.remove('drag-over');
        if (draggedItem && !isConnecting) { 
            createBlockFromDrop(e);
        }
    });
    
    function createBlockFromDrop(e) {
        const blockType = draggedItem.dataset.type;
        const blockName = draggedItem.dataset.name;
        const newBlockId = `block-${blockIdCounter++}`;

        const newBlockEl = document.createElement('div');
        newBlockEl.classList.add('dropped-block');
        newBlockEl.setAttribute('id', newBlockId);
        newBlockEl.dataset.type = blockType;
        newBlockEl.dataset.name = blockName;

        const workspaceRect = workspace.getBoundingClientRect();
        let x = e.clientX - workspaceRect.left - (newBlockEl.offsetWidth / 2 || 75);
        let y = e.clientY - workspaceRect.top - (newBlockEl.offsetHeight / 2 || 30);

        x = Math.max(0, Math.min(x, workspace.clientWidth - (newBlockEl.offsetWidth || 150)));
        y = Math.max(0, Math.min(y, workspace.clientHeight - (newBlockEl.offsetHeight || 60)));

        newBlockEl.style.left = `${x}px`;
        newBlockEl.style.top = `${y}px`;

        const contentDiv = document.createElement('div'); 
        contentDiv.classList.add('block-content');
        const title = document.createElement('h4');
        title.textContent = blockName;
        contentDiv.appendChild(title);
        newBlockEl.appendChild(contentDiv);
        
        workspace.appendChild(newBlockEl);

        pipeline.blocks[newBlockId] = {
            el: newBlockEl,
            name: blockName,
            type: blockType,
            x: x,
            y: y,
            config: {}, 
            connections: { in: [], out: [] }
        };
        
        addPortsToBlock(newBlockEl, blockType);
        makeBlockDraggableAndSelectable(newBlockEl);
        updateWorkspacePlaceholder();
        selectBlock(newBlockEl);
    }

    function addPortsToBlock(blockEl, blockType) {
        if (blockType !== 'trigger') { 
            const inputPort = createPortElement(blockEl, 'input');
            blockEl.appendChild(inputPort);
        }
        if (blockType !== 'action') { 
            const outputPort = createPortElement(blockEl, 'output');
            blockEl.appendChild(outputPort);
        }
    }

    function createPortElement(blockEl, portType) {
        const portEl = document.createElement('div');
        portEl.classList.add('port', `${portType}-port`);
        portEl.dataset.blockId = blockEl.id;
        portEl.dataset.portType = portType;

        portEl.addEventListener('click', handlePortClick);
        portEl.addEventListener('mousedown', (e) => e.stopPropagation()); 
        return portEl;
    }

    function handlePortClick(e) {
        e.stopPropagation();
        const clickedPortEl = e.currentTarget;
        const blockId = clickedPortEl.dataset.blockId;
        const portType = clickedPortEl.dataset.portType;

        if (!isConnecting) {
            if (portType === 'output') { 
                isConnecting = true;
                startConnectionInfo = { blockId, portEl: clickedPortEl, portType };
                clickedPortEl.classList.add('port-active');

                const startPos = getPortCenter(clickedPortEl);
                tempLine = document.createElementNS(SVG_NS, 'line');
                tempLine.setAttribute('class', 'temp-line');
                tempLine.setAttribute('x1', startPos.x);
                tempLine.setAttribute('y1', startPos.y);
                tempLine.setAttribute('x2', startPos.x);
                tempLine.setAttribute('y2', startPos.y);
                connectionsSVG.appendChild(tempLine);

                document.addEventListener('mousemove', onMouseMoveTempLine);
                document.addEventListener('click', cancelConnectionAttempt, true); 
            }
        } else {
            if (startConnectionInfo.blockId !== blockId && portType === 'input') { 
                if (validateConnection(startConnectionInfo, { blockId, portEl: clickedPortEl, portType })) {
                    createConnection(startConnectionInfo, { blockId, portEl: clickedPortEl, portType });
                } else {
                    alert("Недопустимое соединение!");
                }
            }
            resetConnectionAttempt();
        }
    }

    function onMouseMoveTempLine(e) {
        if (isConnecting && tempLine) {
            const workspaceRect = workspace.getBoundingClientRect();
            const x2 = e.clientX - workspaceRect.left;
            const y2 = e.clientY - workspaceRect.top;
            tempLine.setAttribute('x2', x2);
            tempLine.setAttribute('y2', y2);
        }
    }
    
    function cancelConnectionAttempt(e) {
        if (isConnecting && e.target && !e.target.classList.contains('port')) {
            resetConnectionAttempt();
        }
    }

    function resetConnectionAttempt() {
        if (startConnectionInfo && startConnectionInfo.portEl) {
            startConnectionInfo.portEl.classList.remove('port-active');
        }
        isConnecting = false;
        startConnectionInfo = null;
        if (tempLine) {
            tempLine.remove();
            tempLine = null;
        }
        document.removeEventListener('mousemove', onMouseMoveTempLine);
        document.removeEventListener('click', cancelConnectionAttempt, true);
    }

    function validateConnection(startInfo, endInfo) {
        const fromBlockData = pipeline.blocks[startInfo.blockId];
        const toBlockData = pipeline.blocks[endInfo.blockId];

        if (startInfo.blockId === endInfo.blockId) return false;
        if (startInfo.portType !== 'output' || endInfo.portType !== 'input') return false;

        if (fromBlockData.type === 'action' || toBlockData.type === 'trigger') return false;
        
        if (toBlockData.connections.in.length > 0) {
            console.warn(`Блок ${endInfo.blockId} уже имеет входящее соединение.`);
            return false;
        }

        if (pathExists(endInfo.blockId, startInfo.blockId)) {
            console.warn("Создание этого соединения приведет к циклу!");
            return false;
        }
        
        return true;
    }
    
    function pathExists(startNodeId, endNodeId, visited = {}) {
        if (startNodeId === endNodeId) return true;
        visited[startNodeId] = true;

        const block = pipeline.blocks[startNodeId];
        if (!block) return false;

        for (const connId of block.connections.out) {
            const conn = pipeline.connections[connId];
            if (conn && !visited[conn.toBlockId]) {
                if (pathExists(conn.toBlockId, endNodeId, visited)) {
                    return true;
                }
            }
        }
        return false;
    }

    function createConnection(startInfo, endInfo) {
        const connId = `conn-${connectionIdCounter++}`;
        
        const lineEl = document.createElementNS(SVG_NS, 'line');
        lineEl.setAttribute('class', 'connection-line');
        lineEl.setAttribute('id', connId);
        connectionsSVG.appendChild(lineEl);

        pipeline.connections[connId] = {
            fromBlockId: startInfo.blockId,
            fromPortType: startInfo.portType, 
            toBlockId: endInfo.blockId,
            toPortType: endInfo.portType,     
            lineEl: lineEl
        };

        pipeline.blocks[startInfo.blockId].connections.out.push(connId);
        pipeline.blocks[endInfo.blockId].connections.in.push(connId);
        
        updateConnectionLine(connId);
        console.log('Connection created:', connId, pipeline.connections[connId]);
    }

    function updateConnectionLine(connId) {
        const conn = pipeline.connections[connId];
        if (!conn) return;

        const fromBlockEl = document.getElementById(conn.fromBlockId);
        const toBlockEl = document.getElementById(conn.toBlockId);

        if (!fromBlockEl || !toBlockEl) {
            removeConnection(connId);
            return;
        }

        const outPort = fromBlockEl.querySelector('.output-port');
        const inPort = toBlockEl.querySelector('.input-port');

        if (!outPort || !inPort) {
             console.error("Порты не найдены для обновления линии", connId);
             return;
        }

        const startPos = getPortCenter(outPort);
        const endPos = getPortCenter(inPort);

        conn.lineEl.setAttribute('x1', startPos.x);
        conn.lineEl.setAttribute('y1', startPos.y);
        conn.lineEl.setAttribute('x2', endPos.x);
        conn.lineEl.setAttribute('y2', endPos.y);
    }
    
    function updateConnectionsForBlock(blockId) {
        const blockData = pipeline.blocks[blockId];
        if (!blockData) return;
        blockData.connections.in.forEach(connId => updateConnectionLine(connId));
        blockData.connections.out.forEach(connId => updateConnectionLine(connId));
    }

    function getPortCenter(portEl) {
        const portRect = portEl.getBoundingClientRect();
        const workspaceRect = workspace.getBoundingClientRect();
        return {
            x: portRect.left + portRect.width / 2 - workspaceRect.left + workspace.scrollLeft,
            y: portRect.top + portRect.height / 2 - workspaceRect.top + workspace.scrollTop
        };
    }
    
    function removeConnection(connId) {
        const conn = pipeline.connections[connId];
        if (!conn) return;

        if (conn.lineEl) conn.lineEl.remove();
        
        const fromBlock = pipeline.blocks[conn.fromBlockId];
        if (fromBlock) {
            fromBlock.connections.out = fromBlock.connections.out.filter(id => id !== connId);
        }
        const toBlock = pipeline.blocks[conn.toBlockId];
        if (toBlock) {
            toBlock.connections.in = toBlock.connections.in.filter(id => id !== connId);
        }
        delete pipeline.connections[connId];
        console.log('Connection removed:', connId);
    }

    function removeConnectionsForBlock(blockId) {
        const blockData = pipeline.blocks[blockId];
        if (!blockData) return;
        [...blockData.connections.in].forEach(connId => removeConnection(connId));
        [...blockData.connections.out].forEach(connId => removeConnection(connId));
    }

    function makeBlockDraggableAndSelectable(blockEl) {
        let offsetX, offsetY;
        let isDraggingBlock = false;

        blockEl.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('port')) return;
            if (isConnecting) return;

            isDraggingBlock = true;
            offsetX = e.clientX - blockEl.getBoundingClientRect().left;
            offsetY = e.clientY - blockEl.getBoundingClientRect().top;
            blockEl.style.cursor = 'grabbing';
            blockEl.style.zIndex = 1000;

            selectBlock(blockEl);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDraggingBlock) return;
            
            const workspaceRect = workspace.getBoundingClientRect();
            let newX = e.clientX - offsetX - workspaceRect.left + workspace.scrollLeft;
            let newY = e.clientY - offsetY - workspaceRect.top + workspace.scrollTop;

            newX = Math.max(0, Math.min(newX, workspace.scrollWidth - blockEl.offsetWidth));
            newY = Math.max(0, Math.min(newY, workspace.scrollHeight - blockEl.offsetHeight));

            blockEl.style.left = `${newX}px`;
            blockEl.style.top = `${newY}px`;
            
            pipeline.blocks[blockEl.id].x = newX;
            pipeline.blocks[blockEl.id].y = newY;

            updateConnectionsForBlock(blockEl.id);
        });

        document.addEventListener('mouseup', () => {
            if (isDraggingBlock) {
                isDraggingBlock = false;
                blockEl.style.cursor = 'move';
                blockEl.style.zIndex = 1; 
                updateConnectionsForBlock(blockEl.id); 
            }
        });
    }

    function selectBlock(blockElement) {
        if (activeBlock && activeBlock !== blockElement) {
            activeBlock.classList.remove('selected');
        }
        activeBlock = blockElement;
        activeBlock.classList.add('selected');
        renderProperties(pipeline.blocks[activeBlock.id]);
    }
    
    workspace.addEventListener('click', (e) => {
        if (e.target === workspace && !isConnecting) { 
            if (activeBlock) {
                activeBlock.classList.remove('selected');
                activeBlock = null;
                renderProperties(null);
            }
        }
    });

    function renderProperties(blockData) { 
        propertiesContent.innerHTML = '';
        if (!blockData) {
            propertiesContent.innerHTML = '<p>Выберите блок для настройки.</p>';
            return;
        }
        const blockId = blockData.el.id;

        const title = document.createElement('h3');
        title.textContent = `Свойства: ${blockData.name}`;
        propertiesContent.appendChild(title);

        const idPara = document.createElement('p');
        idPara.textContent = `ID: ${blockId}`;
        propertiesContent.appendChild(idPara);
        
        const typePara = document.createElement('p');
        typePara.textContent = `Тип: ${blockData.type}`;
        propertiesContent.appendChild(typePara);

        const currentConfig = blockData.config || {};

        if (blockData.name === 'Фильтр') {
            createPropertyInput('filterField', 'Поле для фильтрации (JSONPath):', 'event.data.severity', currentConfig, blockData);
            createPropertyInput('filterValue', 'Значение:', 'critical', currentConfig, blockData);
        } else if (blockData.name === 'HTTP Webhook') {
             const urlPara = document.createElement('p');
             urlPara.innerHTML = `<strong>URL для приема:</strong> <code>/webhook/${blockId}</code> (генерируется системой)`;
             propertiesContent.appendChild(urlPara);
        } else if (blockData.name === 'Отправить в WhatsApp') {
            createPropertyInput('whatsAppChat', 'Чат WhatsApp:', '#alerts', currentConfig, blockData);
            createPropertyTextarea('whatsAppMessage', 'Шаблон сообщения:', 'Алерт: {{event.name}} в {{event.source}}', currentConfig, blockData);
        } else {
            const soonPara = document.createElement('p');
            soonPara.textContent = 'Настройка для этого блока пока не доступна.';
            propertiesContent.appendChild(soonPara);
        }
        
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Удалить блок';
        deleteButton.className = 'delete-button'; 
        deleteButton.onclick = () => {
            removeConnectionsForBlock(blockId);
            blockData.el.remove();
            delete pipeline.blocks[blockId];
            
            if (activeBlock && activeBlock.id === blockId) {
                activeBlock = null;
                renderProperties(null);
            }
            updateWorkspacePlaceholder();
        };
        propertiesContent.appendChild(deleteButton);
    }

    function createPropertyInput(configKey, labelText, placeholder, currentConfig, blockData) {
        const label = document.createElement('label');
        label.textContent = labelText;
        propertiesContent.appendChild(label);
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.value = currentConfig[configKey] || '';
        input.onchange = (e) => {
            blockData.config[configKey] = e.target.value;
        };
        propertiesContent.appendChild(input);
    }
    function createPropertyTextarea(configKey, labelText, placeholder, currentConfig, blockData) {
        const label = document.createElement('label');
        label.textContent = labelText;
        propertiesContent.appendChild(label);
        const textarea = document.createElement('textarea');
        textarea.rows = 3;
        textarea.placeholder = placeholder;
        textarea.value = currentConfig[configKey] || '';
        textarea.onchange = (e) => {
            blockData.config[configKey] = e.target.value;
        };
        propertiesContent.appendChild(textarea);
    }


    function updateWorkspacePlaceholder() {
        if (Object.keys(pipeline.blocks).length > 0) {
            workspacePlaceholder.style.display = 'none';
        } else {
            workspacePlaceholder.style.display = 'block';
        }
    }

     document.getElementById('savePipeline').addEventListener('click', () => {
        const pipelineData = { 
            blocks: Object.values(pipeline.blocks).map(b => ({
                id: b.el.id,
                name: b.name,
                type: b.type,
                x: b.x,
                y: b.y,
                config: b.config
            })),
            connections: Object.values(pipeline.connections).map(c => ({
                id: c.lineEl.id,
                fromBlockId: c.fromBlockId,
                toBlockId: c.toBlockId
            }))
        };

        const jsonString = JSON.stringify(pipelineData, null, 2);

        const blob = new Blob([jsonString], { type: 'application/json' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);

        const fileName = `pipeline_config_${new Date().toISOString().slice(0, 10)}.json`;
        link.download = fileName;

        document.body.appendChild(link);
        link.click();

        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        console.log("Конфигурация пайплайна подготовлена для скачивания как:", fileName);
        alert(`Конфигурация пайплайна будет скачана как "${fileName}"`);
    });
});
