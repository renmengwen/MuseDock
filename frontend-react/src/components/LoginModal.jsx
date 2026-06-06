export function LoginModal({ open, state, onClose }) {
  if (!open) return null;

  return (
    <div className="modalOverlay">
      <div className="modal">
        <h3>抖音扫码登录</h3>
        <p className="hint">{state.hint || '正在打开浏览器...'}</p>
        {state.qrcode ? <img className="qrImage" src={state.qrcode} alt="抖音登录二维码" /> : null}
        {state.waiting ? <div className="waiting">等待处理...</div> : null}
        {state.success ? <div className="successText">{state.success}</div> : null}
        {state.error ? <div className="errorText">{state.error}</div> : null}
        <button className="btn secondary" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}
