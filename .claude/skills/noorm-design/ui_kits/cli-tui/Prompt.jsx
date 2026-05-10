/* eslint-disable */
// Prompt.jsx — one prompt line + optional output block.
function Prompt({ cmd, output, cwd = '~/projects/orders', cursor = false }) {
  const c = { prompt: '#916336', cwd: '#4B7398', cmd: '#F2ECE0', out: '#B8B3A8', ok: '#6E8F4E', err: '#E05742', hi: '#ED7561' };
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <span style={{ color: c.cwd }}>{cwd}</span>
        <span style={{ color: c.prompt }}> ❯ </span>
        <span style={{ color: c.cmd }}>{cmd}</span>
        {cursor && <span style={{ display: 'inline-block', width: 8, height: 14, background: '#E05742', verticalAlign: '-2px', marginLeft: 2, animation: 'noormBlink 1.1s steps(1,end) infinite' }}/>}
      </div>
      {output && <div style={{ fontSize: 13, lineHeight: 1.7, color: c.out, paddingLeft: 0, marginTop: 4 }}>{output}</div>}
    </div>
  );
}
window.Prompt = Prompt;
