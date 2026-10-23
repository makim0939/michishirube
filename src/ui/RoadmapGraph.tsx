import dagre from '@dagrejs/dagre'
import { Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { computeStates } from '../domain/logic'
import type { Skill, SkillState } from '../domain/types'
import { splitName, STATE_LABEL } from './common'
import { PatternImage } from './PatternImage'
import { go } from './router'
import { t } from '../i18n'

const NODE_WIDTH = 208
const NODE_HEIGHT = 60

type SkillNode = Node<{ name: string; state: SkillState }, 'skill'>

/** 型1つ。見本の絵・名前・いまの状態を出す */
function SkillNodeView({ data }: NodeProps<SkillNode>) {
  return (
    <div className={`graph-node state-${data.state}`} style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}>
      <Handle type="target" position={Position.Top} />
      <PatternImage name={data.name} className="graph-node-image" dim={data.state === 'locked'} />
      <span className="graph-node-text">
        <span className="graph-node-label">{splitName(data.name).main}</span>
        <span className="graph-node-state">{STATE_LABEL[data.state]}</span>
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { skill: SkillNodeView }

function layout(skills: Skill[], practicing: ReadonlySet<string>): { nodes: SkillNode[]; edges: Edge[]; focus: string[] } {
  const states = computeStates(skills, practicing)
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 24, ranksep: 56, marginx: 8, marginy: 8 })
  g.setDefaultEdgeLabel(() => ({}))
  const ids = new Set(skills.map((s) => s.id))
  for (const s of skills) g.setNode(s.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  const edges: Edge[] = []
  for (const s of skills) {
    for (const p of s.prereqIds) {
      if (!ids.has(p)) continue
      g.setEdge(p, s.id)
      const done = states.get(p) === 'done'
      edges.push({
        id: `${p}->${s.id}`,
        source: p,
        target: s.id,
        className: done ? 'edge-done' : 'edge-todo',
        animated: done && states.get(s.id) !== 'done',
      })
    }
  }
  dagre.layout(g)
  const nodes: SkillNode[] = skills.map((s) => {
    const { x, y } = g.node(s.id)
    return {
      id: s.id,
      type: 'skill',
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      data: { name: s.name, state: states.get(s.id)! },
    }
  })
  return { nodes, edges, focus: frontier(skills, states) }
}

/**
 * 最初に映す範囲。全体を収めるとスマホでは文字が読めないので、
 * 「次のおすすめ・練習中」の型と、その直前・直後だけに寄せる
 */
function frontier(skills: Skill[], states: Map<string, SkillState>): string[] {
  const current = skills.filter((s) => ['available', 'active'].includes(states.get(s.id)!))
  if (current.length === 0) return []
  const ids = new Set(current.map((s) => s.id))
  for (const s of current) for (const p of s.prereqIds) ids.add(p)
  for (const s of skills) if (s.prereqIds.some((p) => current.some((c) => c.id === p))) ids.add(s.id)
  return [...ids]
}

export function RoadmapGraph({ skills, practicing }: { skills: Skill[]; practicing: ReadonlySet<string> }) {
  const { nodes, edges, focus } = useMemo(() => layout(skills, practicing), [skills, practicing])
  return (
    <div className="graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => go(`/skill/${node.id}`)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        colorMode="light"
        fitView
        fitViewOptions={focus.length > 0 ? { nodes: focus.map((id) => ({ id })), padding: 0.2, maxZoom: 1 } : { padding: 0.1 }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Controls showInteractive={false} fitViewOptions={{ padding: 0.1 }} aria-label={t.roadmap.graphControls} />
      </ReactFlow>
    </div>
  )
}
