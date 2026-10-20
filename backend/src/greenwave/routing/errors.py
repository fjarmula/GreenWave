"""Domain errors used by route planning and mapped by the API layer."""


class RoutePlanningError(Exception):
    """Base class for expected user-visible routing failures."""


class OriginOffNetwork(RoutePlanningError):
    """The requested origin is farther than the configured snap limit."""


class DestinationOffNetwork(RoutePlanningError):
    """The requested destination is farther than the configured snap limit."""


class NoRoute(RoutePlanningError):
    """Both endpoints snapped but no directed route joins them."""


class NoStationReachable(RoutePlanningError):
    """No station of the requested vehicle type has a directed route to the incident."""
