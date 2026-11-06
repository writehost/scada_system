"""SCADA System Route — сервис позиционирования погрузчика по меткам AprilTag.

Камера (Hikrobot, вверх) → обнаружение AprilTag → оценка позы камеры → пересчёт в корпус погрузчика →
фильтр → POST /api/route/forklifts/{karaId}/position (SCADA System Route / YMS).
"""

__version__ = "1.0.0"
