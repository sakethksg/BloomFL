"""
Transport factory — returns the configured :class:`BaseTransport`.
"""
from __future__ import annotations

from typing import Literal

from bloomfl.transport.base import BaseTransport


def get_transport(transport_type: Literal["tcp", "grpc"] = "tcp") -> BaseTransport:
    """Instantiate and return a transport by name.

    Args:
        transport_type: ``"tcp"`` (default) or ``"grpc"``.

    Returns:
        An uninitialised :class:`BaseTransport` subclass instance.

    Raises:
        ValueError: For unknown transport type strings.
    """
    if transport_type == "tcp":
        from bloomfl.transport.tcp_transport import TCPTransport
        return TCPTransport()
    elif transport_type == "grpc":
        from bloomfl.transport.grpc_transport import GRPCTransport
        return GRPCTransport()
    else:
        raise ValueError(
            f"Unknown transport '{transport_type}'. Choices: 'tcp', 'grpc'."
        )
