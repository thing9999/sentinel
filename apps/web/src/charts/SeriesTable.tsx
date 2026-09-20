/**
 * 차트 `표로 보기` 대체 표 (status.md 7절: 차트 옆 표로 같은 데이터).
 */
import styles from "./charts.module.css";

export interface SeriesTableProps {
  caption: string;
  columns: string[];
  rows: { key: string; cells: string[] }[];
}

export function SeriesTable({ caption, columns, rows }: SeriesTableProps) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) => (
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
