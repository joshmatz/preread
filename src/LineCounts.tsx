import { useMemo } from "react";
import { Info } from "lucide-react";
import { Popover } from "./Popover";
import { lineAreaLabels, lineCounts, type LineArea, type LineCount } from "./line-counts";
import type { ChangedFile } from "./types";

export function LineCounts({ files }: { files: ChangedFile[] }) {
  const { areas, total } = useMemo(() => lineCounts(files), [files]);
  const { runtime } = areas;
  const shown = (Object.keys(areas) as LineArea[]).filter(
    (area) => area === "runtime" || areas[area].plus || areas[area].minus,
  );
  return (
    <Popover
      label="Line counts"
      className="totals"
      title={`Runtime lines: ${runtime.plus} added, ${runtime.minus} removed`}
      width={260}
      hover
      panel={() => (
        <div className="line-counts">
          <table>
            <tbody>
              {shown.map((area) => (
                <Row key={area} label={lineAreaLabels[area]} count={areas[area]} />
              ))}
            </tbody>
            <tfoot>
              <Row label="Total" count={total} />
            </tfoot>
          </table>
          <p>
            The header counts Runtime: code outside tests and evals. Misc is docs, config, and data,
            like .md and .json.
            {files.some((file) => file.untracked) && " Untracked files aren’t counted."}
          </p>
        </div>
      )}
    >
      <span className="additions">+{runtime.plus.toLocaleString()}</span>
      <span className="deletions">−{runtime.minus.toLocaleString()}</span>
      <Info size={13} />
    </Popover>
  );
}

function Row({ label, count }: { label: string; count: LineCount }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="additions">+{count.plus.toLocaleString()}</td>
      <td className="deletions">−{count.minus.toLocaleString()}</td>
    </tr>
  );
}
