export default function Sidebar({ title, side = 'left', children }) {
  return (
    <aside className={`sidebar sidebar-${side}`} aria-label={title}>
      <div className="sidebar-title">{title}</div>
      {children}
    </aside>
  );
}
