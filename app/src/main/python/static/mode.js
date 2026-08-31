// mode.js - interruptor ON/OFF do Kraken (2026-08-31, ideia do Gilcimar,
// esqueleto construído na mesma sessão).
//
// Paradigma que resolve: o Kraken vinha tentando ser "esperto" sozinho
// sobre quando usar malha local vs. internet, misturando os dois o
// tempo todo - fonte real de confusão e bug essa semana (upload
// travando, chamada relay, etc). Em vez disso, a pessoa escolhe:
//
//   ON  (verde) = chat online normal (texto/voz/vídeo/chamada/live,
//        estilo WhatsApp/TikTok) - usa internet, ignora malha local.
//   OFF (vermelho) = só malha local P2P - ignora internet de propósito,
//        mesmo se o aparelho tiver conexão disponível.
//
// Histórico de mensagens (de qualquer modo) continua sempre visível -
// o interruptor só afeta o que está ativo/conectando AGORA, não o que
// já foi recebido antes.
//
// ESCOPO DESTE ESQUELETO (2026-08-31): controla a UI (mostra/esconde
// elementos marcados com data-mode-only="on"/"off") e para o app de
// falar com a Oracle (chamada/relay) quando em OFF. AINDA NÃO FEITO,
// fica pro próximo passo: parar de verdade as threads de malha local
// (broadcast UDP/gossip TCP) no backend quando ON, roteamento de
// mensagem separado por modo, e a peneira de presença (ON só vê ON,
// OFF só vê OFF) descrita pelo Gilcimar.
(function () {
  const KEY = "kraken_mode";

  function getMode() {
    return localStorage.getItem(KEY) === "off" ? "off" : "on";
  }

  function applyMode(m) {
    document.documentElement.dataset.krakenMode = m;
    const btn = document.getElementById("mode-toggle");
    const txt = document.getElementById("mode-toggle-text");
    if (btn) {
      btn.classList.toggle("on", m === "on");
      btn.classList.toggle("off", m === "off");
      btn.title = m === "on"
        ? "Modo ON - chat online (clique pra mudar pra OFF/malha local)"
        : "Modo OFF - só malha local (clique pra mudar pra ON/online)";
    }
    if (txt) txt.textContent = m === "on" ? "ON" : "OFF";
    document.querySelectorAll("[data-mode-only]").forEach((el) => {
      el.hidden = el.dataset.modeOnly !== m;
    });
  }

  function setMode(m) {
    localStorage.setItem(KEY, m);
    applyMode(m);
  }

  function initToggle() {
    const btn = document.getElementById("mode-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const atual = getMode();
      const proximo = atual === "on" ? "off" : "on";
      if (proximo === "off" && navigator.onLine) {
        const ok = confirm(
          "Você está conectado à internet.\n\n" +
          "Deseja desconectar para o modo OFF (só malha local)?"
        );
        if (!ok) return;
      }
      setMode(proximo);
    });
    applyMode(getMode());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initToggle);
  } else {
    initToggle();
  }

  // Exposto pro app.js consultar (ex: pular chamada relay em modo OFF).
  window.KrakenMode = { get: getMode, set: setMode };
})();
