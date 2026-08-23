// api/scan.js
const http = require('http');
const https = require('https');
const net = require('net');

export default async function handler(req, res) {
    // 1. 입력값 확인
    const { domain, port } = req.query;
    if (!domain || !port) {
        return res.status(400).json({ error: '도메인과 포트 정보가 필요합니다.' });
    }

    // 2. 포트 오픈 여부 확인 (TCP Socket)
    const checkTCP = (host, targetPort) => {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(3000); // 3초 타임아웃
            socket.on('connect', () => {
                socket.destroy();
                resolve(true); // 포트 열림
            });
            socket.on('timeout', () => {
                socket.destroy();
                resolve(false); // 포트 닫힘 (타임아웃)
            });
            socket.on('error', () => {
                socket.destroy();
                resolve(false); // 연결 거부 등
            });
            socket.connect(targetPort, host);
        });
    };

    // 3. 웹 서비스 여부 확인 (HTTP/HTTPS HEAD 요청)
    const checkWeb = (scheme, host, targetPort) => {
        return new Promise((resolve) => {
            const client = scheme === 'https' ? https : http;
            const request = client.request({
                method: 'HEAD',
                host: host,
                port: targetPort,
                timeout: 3000,
                rejectUnauthorized: false // 인증서 에러 무시 (스캔 목적)
            }, (response) => {
                resolve({ isWeb: true, statusCode: response.statusCode });
            });
            request.on('timeout', () => { request.destroy(); resolve({ isWeb: false }); });
            request.on('error', () => { resolve({ isWeb: false }); });
            request.end();
        });
    };

    try {
        // TCP 포트가 열려있는지 먼저 확인
        const isOpen = await checkTCP(domain, port);
        
        if (!isOpen) {
            return res.status(200).json({
                status: "접속 불가 (Closed)",
                detail: "응답 없음 (포트 닫힘 또는 차단됨)",
                isOpen: false
            });
        }

        // 포트가 열려있다면 웹 서비스인지 확인
        let scheme = port === '443' ? 'https' : 'http';
        let webResult = await checkWeb(scheme, domain, port);

        // 기본 scheme으로 실패시 반대 scheme 시도 (예: 8080포트가 https일 수도 있으므로)
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
