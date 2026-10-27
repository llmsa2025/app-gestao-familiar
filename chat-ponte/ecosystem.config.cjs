// A ponte do Chat IA sob o pm2 (já instalado no VPS):  pm2 start chat-ponte/ecosystem.config.cjs && pm2 save
// A configuração (senha da ponte, token do Claude) fica em ~/.chat-ia-ponte.env, fora do repositório.
module.exports = {
  apps: [{
    name: "gf-chat-ponte",
    script: "iniciar.mjs",
    cwd: __dirname,
    interpreter: "node",
    autorestart: true,
    max_restarts: 50,
    restart_delay: 5000,
    // desligar = SIGTERM e tempo para a ponte matar o motor e apagar a pasta com o dossiê (o pm2 usa SIGINT por padrão)
    kill_signal: "SIGTERM",
    kill_timeout: 8000,
    // o VPS divide memória com outros apps: a ponte parada é um processo de ~40 MB; reinicia se passar muito disto
    max_memory_restart: "300M",
    time: true,
    env: { NODE_ENV: "production" },
  }],
};
