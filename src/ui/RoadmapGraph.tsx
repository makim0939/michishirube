import dagre from '@dagrejs/dagre'
import { Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { computeStates } from '../domain/logic'
import type { Skill, SkillState } from '../domain/types'
import { STATE_ICON } from './common'
import { go } from './router'

const NODE_WIDTH = 168
const NODE_HEIGHT = 56

type SkillNode = Node<{ label: string; state: SkillState }, 'skill'>

function SkillNodeView({ data }: NodeProps<SkillNode>) {
  return (
    <div className={`graph-node state-${data.state}`}>
      <Handle type="target" position={Position.Top} />
      <span className="graph-node-icon" aria-hidden="true">
        {STATE_ICON[data.state]}
      </span>
      <span className="graph-node-label">{data.label}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { skill: SkillNodeView }

function layout(skills: Skill[]): { nodes: SkillNode[]; edges: Edge[]; focus: string[] } {
  const states = computeStates(skills)
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
      data: { label: s.name, state: states.get(s.id)! },
    }
  })
  return { nodes, edges, focus: frontier(skills, states) }
}

/**
 * 最初に映す範囲。全体を収めるとスマホでは文字が読めないので、
 * 「いま挑戦できる・挑戦中」のスキルと、その直前・直後だけに寄せる
 */
function frontier(skills: Skill[], states: Map<string, SkillState>): string[] {
  const current = skills.filter((s) => ['available', 'active'].includes(states.get(s.id)!))
  if (current.length === 0) return []
  const ids = new Set(current.map((s) => s.id))
  for (const s of current) for (const p of s.prereqIds) ids.add(p)
  for (const s of skills) if (s.prereqIds.some((p) => current.some((c) => c.id === p))) ids.add(s.id)
  return [...ids]
}

export function RoadmapGraph({ skills }: { skills: Skill[] }) {
  const { nodes, edges, focus } = useMemo(() => layout(skills), [skills])
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
        colorMode="system"
        fitView
        fitViewOptions={focus.length > 0 ? { nodes: focus.map((id) => ({ id })), padding: 0.2, maxZoom: 1 } : { padding: 0.1 }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Controls showInteractive={false} fitViewOptions={{ padding: 0.1 }} aria-label="表示の操作" />
      </ReactFlow>
    </div>
  )
}
