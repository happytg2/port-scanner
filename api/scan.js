const http = require('http');
const https = require('https');
const net = require('net');

export default async function handler(req, res) {
    const { type, domain, port, ip } = req.query;

    // ==========================================
    // [기능 1] 가상 호스트(도메인) 조회 로직
    // ==========================================
    if (type === 'vhost') {
        if (!ip) return res.status(400).json({ error: 'IP 주소가 필요합니다.' });
        
        let domains = [];
        let errorType = null;
        let usedFallback = false;
        
        try {
            // 1차 시도: HackerTarget
            let htRes = await fetch(`https://api.hackertarget.com/reverseiplookup/?q=${ip}`);
            let htText = await htRes.text();
            let parsed = htText.split('\n').map(d => d.trim()).filter(d => d);
            
            if (parsed.length > 0 && parsed[0].toLowerCase().includes('api count')) {
                throw new Error("HT_LIMIT");
            } else if (parsed.length > 0 && (parsed[0].toLowerCase().includes('no dns') || parsed[0].toLowerCase().includes('error'))) {
                errorType = 'nodata';
            } else {
                domains = parsed;
            }
        } catch (e) {
            // 2차 시도: Robtex
            try {
                let robRes = await fetch(`https://freeapi.robtex.com/ipquery/${ip}`);
                let robData = await robRes.json();
                
                if (robData && robData.pasv && robData.pasv.length > 0) {
                    domains = [...new Set(robData.pasv.map(item => item.o))];
                    usedFallback = true;
                } else {
                    errorType = 'nodata';
                }
            } catch (fallbackErr) {
                errorType = (e.message === "HT_LIMIT") ? 'limit' : 'error';
            }
        }
        
        return res.status(200).json({ domains, errorType, usedFallback });
    }

    // ==========================================
    // [기능 2] 포트 스캔 및 웹 서비스 확인 로직
    // ==========================================
    if (!domain || !port) {
        return res.status(400).json({ error: '도메인과 포트 정보가 필요합니다.' });
    }

    // TCP 소켓 통신 타임아웃 6000ms (6초) 설정
    const checkTCP = (host, targetPort) => {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(6000); 
            socket.on('connect', () => { socket.destroy(); resolve(true); });
            socket.on('timeout', () => { socket.destroy(); resolve(false); });
            socket.on('error', () => { socket.destroy(); resolve(false); });
            socket.connect(targetPort, host);
        });
    };

    // 웹 HTTP/HTTPS 응답 타임아웃 6000ms (6초) 설정
    const checkWeb = (scheme, host, targetPort) => {
        return new Promise((resolve) => {
            const client = scheme === 'https' ? https : http;
            const request = client.request({
                method: 'HEAD',
                host: host,
                port: targetPort,
                timeout: 6000,
                rejectUnauthorized: false
            }, (response) => {
                resolve({ isWeb: true, statusCode: response.statusCode });
            });
            request.on('timeout', () => { request.destroy(); resolve({ isWeb: false }); });
            request.on('error', () => { resolve({ isWeb: false }); });
            request.end();
        });
    };

    try {
        const isOpen = await checkTCP(domain, port);
        
        if (!isOpen) {
            return res.status(200).json({
                status: "접속 불가 (Closed)",
                detail: "응답 없음 (포트 닫힘, 차단됨 또는 타임아웃)",
                isOpen: false
            });
        }

        let scheme = port === '443' ? 'https' : 'http';
        let webResult = await checkWeb(scheme, domain, port);

        if (!webResult.isWeb && port !== '80' && port !== '443') {
            const altScheme = scheme === 'https' ? 'http' : 'https';
            webResult = await checkWeb(altScheme, domain, port);
            if (webResult.isWeb) scheme = altScheme;
        }

        if (webResult.isWeb) {
            return res.status(200).json({
                status: "접속 가능 (Open)",
                detail: `웹 서비스 맞음 (${scheme.toUpperCase()}, 응답코드: ${webResult.statusCode})`,
                isOpen: true
            });
        } else {
            return res.status(200).json({
                status: "접속 가능 (Open)",
                detail: "웹 서비스 아님 (포트는 열려있음)",
                isOpen: true
            });
        }
    } catch (error) {
        return res.status(500).json({ error: '서버 내부 오류 발생' });
    }
}
